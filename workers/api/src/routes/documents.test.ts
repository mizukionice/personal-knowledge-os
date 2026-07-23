import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  GITHUB_DISPATCH_TOKEN: 'dummy',
};

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * supabase-jsのクエリビルダーの最小フェイク。
 * どのビルダーメソッドも自身を返し、await / single / maybeSingle で結果を解決する。
 */
function fakeQuery(result: FakeResult) {
  const q = {
    select: () => q,
    insert: () => q,
    delete: () => q,
    order: () => q,
    range: () => q,
    eq: () => q,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

/** table名→結果のマップからfrom()を組み立てる */
function fakeDb(resultsByTable: Record<string, FakeResult | FakeResult[]>) {
  const callCount: Record<string, number> = {};
  const from = vi.fn((table: string) => {
    const entry = resultsByTable[table];
    if (entry === undefined) {
      // 権限ミドルウェアのプロフィール参照は、指定が無ければ「行なし＝既定で全機能許可」にする
      if (table === 'user_profiles') {
        return fakeQuery({ data: null, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    }
    const results = Array.isArray(entry) ? entry : [entry];
    const index = Math.min(callCount[table] ?? 0, results.length - 1);
    callCount[table] = (callCount[table] ?? 0) + 1;
    return fakeQuery(results[index] as FakeResult);
  });
  return { from };
}

const dbHolder: { client: ReturnType<typeof fakeDb> } = {
  client: fakeDb({}),
};

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

async function authedRequest(
  path: string,
  init: RequestInit = {},
  env: Record<string, unknown> = baseEnv,
) {
  const token = await sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
  const app = createApp();
  return app.request(
    path,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    },
    env,
  );
}

beforeEach(() => {
  dbHolder.client = fakeDb({});
});

describe('POST /v1/documents', () => {
  it('有効なbodyで201と作成行を返す', async () => {
    const created = { id: DOC_ID, title: 'リスクマネジメント概論', doc_type: 'book' };
    dbHolder.client = fakeDb({ documents: { data: created, error: null } });

    const res = await authedRequest('/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'リスクマネジメント概論' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { document: typeof created };
    expect(body.document.id).toBe(DOC_ID);
  });

  it('titleが空なら422 validation_error', async () => {
    const res = await authedRequest('/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  ' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('JSONでないbodyは422', async () => {
    const res = await authedRequest('/v1/documents', {
      method: 'POST',
      body: 'not-json',
    });
    expect(res.status).toBe(422);
  });

  it('DBエラーは500 internal', async () => {
    dbHolder.client = fakeDb({ documents: { data: null, error: { message: 'boom' } } });
    const res = await authedRequest('/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /v1/documents', () => {
  it('一覧とtotalを返す', async () => {
    const rows = [{ id: DOC_ID, title: 'A' }];
    dbHolder.client = fakeDb({ documents: { data: rows, error: null, count: 1 } });

    const res = await authedRequest('/v1/documents');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: rows, total: 1 });
  });

  it('不正なstatusは422', async () => {
    const res = await authedRequest('/v1/documents?status=bogus');
    expect(res.status).toBe(422);
  });
});

describe('GET /v1/documents/:id', () => {
  it('詳細とpages進捗サマリを返す', async () => {
    dbHolder.client = fakeDb({
      documents: { data: { id: DOC_ID, title: 'A' }, error: null },
      pages: {
        data: [{ status: 'completed' }, { status: 'completed' }, { status: 'failed' }],
        error: null,
      },
    });

    const res = await authedRequest(`/v1/documents/${DOC_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document: { pages_summary: { total: number; completed: number; failed: number } };
    };
    expect(body.document.pages_summary).toEqual({
      total: 3,
      pending: 0,
      processing: 0,
      completed: 2,
      failed: 1,
    });
  });

  it('存在しない（RLS外含む）なら404', async () => {
    dbHolder.client = fakeDb({ documents: { data: null, error: null } });
    const res = await authedRequest(`/v1/documents/${DOC_ID}`);
    expect(res.status).toBe(404);
  });

  it('UUIDでないidは422', async () => {
    const res = await authedRequest('/v1/documents/not-a-uuid');
    expect(res.status).toBe(422);
  });
});

describe('DELETE /v1/documents/:id', () => {
  it('R2オブジェクトを消してから204を返す', async () => {
    dbHolder.client = fakeDb({
      documents: [
        { data: { id: DOC_ID, r2_prefix: `${USER_ID}/${DOC_ID}/` }, error: null },
        { data: null, error: null },
      ],
    });
    const r2Delete = vi.fn(async () => {});
    const r2 = {
      list: vi.fn(async () => ({
        objects: [{ key: `${USER_ID}/${DOC_ID}/pages/0001.png` }],
        truncated: false,
      })),
      delete: r2Delete,
    };

    const res = await authedRequest(
      `/v1/documents/${DOC_ID}`,
      { method: 'DELETE' },
      {
        ...baseEnv,
        R2: r2,
      },
    );

    expect(res.status).toBe(204);
    expect(r2.list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: `${USER_ID}/${DOC_ID}/` }),
    );
    expect(r2Delete).toHaveBeenCalledWith([`${USER_ID}/${DOC_ID}/pages/0001.png`]);
  });

  it('存在しなければ404', async () => {
    dbHolder.client = fakeDb({ documents: { data: null, error: null } });
    const res = await authedRequest(`/v1/documents/${DOC_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
