import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';
import { fakeDb } from '../test-support';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  GITHUB_DISPATCH_TOKEN: 'dummy',
  GITHUB_REPO: 'owner/repo',
};

const dbHolder: { client: ReturnType<typeof fakeDb> } = { client: fakeDb({}) };

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER_ID,
    role: 'user',
    can_upload: true,
    can_process: true,
    can_chat: true,
    ...overrides,
  };
}

async function request(path: string, init: RequestInit = {}) {
  const token = await sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
  const app = createApp();
  return app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } },
    baseEnv,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbHolder.client = fakeDb({});
});

describe('requirePermission', () => {
  it('can_upload=falseならPOST /documentsは403 forbidden', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: profileRow({ can_upload: false }), error: null },
    });
    const res = await request('/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '本' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('can_upload=falseならupload-urlも403', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: profileRow({ can_upload: false }), error: null },
    });
    const res = await request(`/v1/documents/${DOC_ID}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/jpeg', page_number: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it('can_process=falseならPOST /documents/:id/processは403', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: profileRow({ can_process: false }), error: null },
    });
    const res = await request(`/v1/documents/${DOC_ID}/process`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('can_chat=falseならPOST /chatは403', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: profileRow({ can_chat: false }), error: null },
    });
    const res = await request('/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'こんにちは' }),
    });
    expect(res.status).toBe(403);
  });

  it('フラグが有効ならハンドラへ到達する', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: profileRow(), error: null },
      documents: { data: { id: DOC_ID, user_id: USER_ID, title: '本' }, error: null },
    });
    const res = await request('/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '本' }),
    });
    expect(res.status).toBe(201);
  });

  it('プロフィール行が無い場合は既定で許可（既存ユーザー互換）', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: null, error: null },
      documents: { data: { id: DOC_ID, user_id: USER_ID, title: '本' }, error: null },
    });
    const res = await request('/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '本' }),
    });
    expect(res.status).toBe(201);
  });

  it('閲覧系（GET /documents）は権限フラグの影響を受けない', async () => {
    dbHolder.client = fakeDb({
      user_profiles: {
        data: profileRow({ can_upload: false, can_process: false, can_chat: false }),
        error: null,
      },
      documents: { data: [], error: null, count: 0 },
    });
    const res = await request('/v1/documents');
    expect(res.status).toBe(200);
  });
});
