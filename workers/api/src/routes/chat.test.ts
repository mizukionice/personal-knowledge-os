import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';
import { fakeDb } from '../test-support';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const dbHolder: { client: ReturnType<typeof fakeDb> } = { client: fakeDb({}) };

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

// Claude APIのストリームをフェイクする。answerHolder.textを分割してdeltaイベント化する
const answerHolder = { text: '回答です[蜘蛛の糸 p.1 §二]。' };

vi.mock('@anthropic-ai/sdk', () => {
  class FakeStream {
    async *[Symbol.asyncIterator]() {
      const text = answerHolder.text;
      const mid = Math.ceil(text.length / 2);
      for (const part of [text.slice(0, mid), text.slice(mid)]) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: part } };
      }
    }
    async finalMessage() {
      return { content: [{ type: 'text', text: answerHolder.text }] };
    }
  }
  class FakeAnthropic {
    messages = { stream: vi.fn(() => new FakeStream()) };
  }
  return { default: FakeAnthropic };
});

const fakeAi = {
  run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
};

const SEARCH_ROW = {
  chunk_id: 'chunk-1',
  content: '犍陀多は蜘蛛の糸を登った。',
  document_id: 'doc-kumo',
  document_title: '蜘蛛の糸',
  page_start: 1,
  page_end: 1,
  section_path: '蜘蛛の糸 > 二',
  score: 0.03,
};

async function post(body: unknown) {
  const token = await sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
  const app = createApp();
  return app.request(
    '/v1/chat',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      GITHUB_DISPATCH_TOKEN: 'dummy',
      GITHUB_REPO: 'owner/repo',
      ANTHROPIC_API_KEY: 'sk-test',
      AI: fakeAi,
    },
  );
}

/** SSEレスポンスを {event, data} の配列にパースする */
function parseSse(text: string): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  for (const block of text.split('\n\n')) {
    const eventMatch = /^event: (.+)$/m.exec(block);
    const dataMatch = /^data: (.+)$/m.exec(block);
    if (eventMatch && dataMatch) {
      events.push({ event: eventMatch[1]!, data: JSON.parse(dataMatch[1]!) });
    }
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeAi.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
  answerHolder.text = '回答です[蜘蛛の糸 p.1 §二]。';
  dbHolder.client = fakeDb(
    {},
    {
      search_chunks: { data: [SEARCH_ROW], error: null },
      expand_related_chunks: { data: [], error: null },
    },
  );
});

describe('POST /v1/chat', () => {
  it('SSEでdeltaを流し、最後にcitations付きdoneを返す', async () => {
    const res = await post({ message: '犍陀多は何をした？' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSse(await res.text());
    const deltas = events.filter((e) => e.event === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((d) => (d.data as { text: string }).text).join('')).toBe(answerHolder.text);

    const done = events.find((e) => e.event === 'done');
    expect(done?.data).toEqual({
      citations: [{ document_id: 'doc-kumo', title: '蜘蛛の糸', page: 1, section_path: '二' }],
      used_general_knowledge: false,
    });

    // 検索→graph expansionの両RPCが呼ばれている
    expect(dbHolder.client.rpc).toHaveBeenCalledWith(
      'search_chunks',
      expect.objectContaining({ query_text: '犍陀多は何をした？', uid: USER_ID }),
    );
    expect(dbHolder.client.rpc).toHaveBeenCalledWith(
      'expand_related_chunks',
      expect.objectContaining({ source_chunk_ids: ['chunk-1'], uid: USER_ID }),
    );
  });

  it('蔵書に無い回答はused_general_knowledge=true', async () => {
    answerHolder.text = 'あなたのライブラリにはこの情報がありません。以下は蔵書外の一般知識です: …';
    const res = await post({ message: 'フランス革命について' });

    const events = parseSse(await res.text());
    const done = events.find((e) => e.event === 'done');
    expect(done?.data).toEqual({ citations: [], used_general_knowledge: true });
  });

  it('messageが無ければ422', async () => {
    const res = await post({});
    expect(res.status).toBe(422);
  });

  it('検索ヒット0件でもチャットは成立する', async () => {
    dbHolder.client = fakeDb({}, { search_chunks: { data: [], error: null } });
    const res = await post({ message: '何か' });
    expect(res.status).toBe(200);
    const events = parseSse(await res.text());
    expect(events.some((e) => e.event === 'done')).toBe(true);
  });
});
