import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';
import { fakeDb } from '../test-support';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONCEPT_ID = '55555555-5555-4555-8555-555555555555';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const dbHolder: { client: ReturnType<typeof fakeDb> } = { client: fakeDb({}) };

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

const fakeAi = {
  run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
};

async function get(path: string) {
  const token = await sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
  const app = createApp();
  return app.request(
    path,
    { headers: { Authorization: `Bearer ${token}` } },
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      GITHUB_DISPATCH_TOKEN: 'dummy',
      GITHUB_REPO: 'owner/repo',
      AI: fakeAi,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeAi.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
});

describe('GET /v1/search', () => {
  it('クエリをembeddingしてsearch_chunks RPCの結果を返す', async () => {
    const results = [
      {
        chunk_id: 'chunk-1',
        content: 'リスク対応の本文',
        document_title: 'リスク本',
        page_start: 12,
        section_path: '第3章',
        score: 0.03,
      },
    ];
    dbHolder.client = fakeDb({}, { search_chunks: { data: results, error: null } });

    const res = await get('/v1/search?q=リスク対応');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results });
    expect(fakeAi.run).toHaveBeenCalledWith('@cf/baai/bge-m3', { text: ['リスク対応'] });
    expect(dbHolder.client.rpc).toHaveBeenCalledWith(
      'search_chunks',
      expect.objectContaining({ query_text: 'リスク対応', uid: USER_ID, match_count: 10 }),
    );
  });

  it('qが無ければ422', async () => {
    const res = await get('/v1/search');
    expect(res.status).toBe(422);
  });
});

describe('GET /v1/concepts', () => {
  it('mentions数付きの概念一覧を返す', async () => {
    dbHolder.client = fakeDb({
      concepts: {
        data: [
          {
            id: CONCEPT_ID,
            canonical_name: 'EVM',
            aliases: ['アーンドバリュー'],
            importance: 0.8,
            concept_mentions: [{ count: 3 }],
          },
        ],
        error: null,
      },
    });

    const res = await get('/v1/concepts?q=EV');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      concepts: [
        {
          id: CONCEPT_ID,
          canonical_name: 'EVM',
          aliases: ['アーンドバリュー'],
          importance: 0.8,
          mention_count: 3,
        },
      ],
    });
  });
});

describe('GET /v1/concepts/:id', () => {
  it('概念詳細（出典別定義・関連概念）を返す', async () => {
    dbHolder.client = fakeDb({
      concepts: {
        data: { id: CONCEPT_ID, canonical_name: 'EVM', aliases: [], importance: 0.8 },
        error: null,
      },
      concept_mentions: {
        data: [
          {
            definition: '出来高管理手法',
            document_id: DOC_ID,
            documents: { title: 'PM入門' },
            chunks: { page_start: 45, section_path: '第4章' },
          },
        ],
        error: null,
      },
      concept_links: {
        data: [
          {
            relation: 'is_a',
            source_concept_id: CONCEPT_ID,
            target_concept_id: 'other-id',
            source: { id: CONCEPT_ID, canonical_name: 'EVM' },
            target: { id: 'other-id', canonical_name: '進捗管理' },
          },
        ],
        error: null,
      },
    });

    const res = await get(`/v1/concepts/${CONCEPT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      definitions: { document_title: string; page_start: number }[];
      related: { canonical_name: string; relation: string; direction: string }[];
    };
    expect(body.definitions[0]).toMatchObject({
      definition: '出来高管理手法',
      document_title: 'PM入門',
      page_start: 45,
    });
    expect(body.related[0]).toEqual({
      concept_id: 'other-id',
      canonical_name: '進捗管理',
      relation: 'is_a',
      direction: 'outgoing',
    });
  });

  it('存在しなければ404', async () => {
    dbHolder.client = fakeDb({ concepts: { data: null, error: null } });
    const res = await get(`/v1/concepts/${CONCEPT_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/documents/:id/concepts', () => {
  it('書籍内の概念をmentions数付きで集計して返す', async () => {
    const concept = { id: CONCEPT_ID, canonical_name: 'EVM', importance: 0.8 };
    dbHolder.client = fakeDb({
      concept_mentions: {
        data: [
          { concept_id: CONCEPT_ID, concepts: concept },
          { concept_id: CONCEPT_ID, concepts: concept },
        ],
        error: null,
      },
    });

    const res = await get(`/v1/documents/${DOC_ID}/concepts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      concepts: [{ ...concept, mention_count: 2 }],
    });
  });
});
