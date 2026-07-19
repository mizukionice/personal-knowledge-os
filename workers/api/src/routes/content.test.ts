import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';
import { fakeDb } from '../test-support';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const dbHolder: { client: ReturnType<typeof fakeDb> } = { client: fakeDb({}) };

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

function fakeR2(objects: Record<string, string>) {
  return {
    get: vi.fn(async (key: string) => (key in objects ? { text: async () => objects[key] } : null)),
  };
}

async function get(path: string, r2: unknown) {
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
      R2: r2,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbHolder.client = fakeDb({
    documents: { data: { id: DOC_ID, user_id: USER_ID }, error: null },
  });
});

describe('GET /v1/documents/:id/markdown', () => {
  it('結合Markdown（full.md）を返す', async () => {
    const r2 = fakeR2({ [`${USER_ID}/${DOC_ID}/markdown/full.md`]: '# 全文' });
    const res = await get(`/v1/documents/${DOC_ID}/markdown`, r2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: '# 全文' });
  });

  it('?page=n で単ページMarkdownを返す', async () => {
    const r2 = fakeR2({ [`${USER_ID}/${DOC_ID}/markdown/0003.md`]: '# p3' });
    const res = await get(`/v1/documents/${DOC_ID}/markdown?page=3`, r2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: '# p3' });
  });

  it('まだ生成されていなければ404', async () => {
    const res = await get(`/v1/documents/${DOC_ID}/markdown`, fakeR2({}));
    expect(res.status).toBe(404);
  });

  it('documentが無ければ404', async () => {
    dbHolder.client = fakeDb({ documents: { data: null, error: null } });
    const res = await get(`/v1/documents/${DOC_ID}/markdown`, fakeR2({}));
    expect(res.status).toBe(404);
  });

  it('不正なpageは422', async () => {
    const res = await get(`/v1/documents/${DOC_ID}/markdown?page=zero`, fakeR2({}));
    expect(res.status).toBe(422);
  });
});
