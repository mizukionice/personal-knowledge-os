import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';
import { fakeDb } from '../test-support';

const JWT_SECRET = 'test-jwt-secret';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';

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

const adminProfile = {
  user_id: ADMIN_ID,
  role: 'admin',
  can_upload: true,
  can_process: true,
  can_chat: true,
};

async function request(path: string, init: RequestInit = {}) {
  const token = await sign(
    { sub: ADMIN_ID, exp: Math.floor(Date.now() / 1000) + 3600 },
    JWT_SECRET,
  );
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

describe('requireAdmin', () => {
  it('一般ユーザーは403 forbidden', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: { ...adminProfile, role: 'user' }, error: null },
    });
    const res = await request('/v1/admin/settings');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('プロフィール行が無いユーザーも403', async () => {
    dbHolder.client = fakeDb({ user_profiles: { data: null, error: null } });
    const res = await request('/v1/admin/settings');
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/admin/settings', () => {
  it('管理者は現在の設定を取得できる', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: adminProfile, error: null },
      app_settings: { data: { signup_enabled: true, updated_at: '2026-07-23T00:00:00Z' }, error: null },
    });
    const res = await request('/v1/admin/settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: { signup_enabled: boolean } };
    expect(body.settings.signup_enabled).toBe(true);
  });
});

describe('PUT /v1/admin/settings', () => {
  it('signup_enabledを切り替えられる', async () => {
    dbHolder.client = fakeDb({
      user_profiles: { data: adminProfile, error: null },
      app_settings: { data: { signup_enabled: false, updated_at: '2026-07-23T00:00:00Z' }, error: null },
    });
    const res = await request('/v1/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signup_enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: { signup_enabled: boolean } };
    expect(body.settings.signup_enabled).toBe(false);
  });

  it('bodyが不正なら422', async () => {
    dbHolder.client = fakeDb({ user_profiles: { data: adminProfile, error: null } });
    const res = await request('/v1/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signup_enabled: 'yes' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('GET /v1/admin/users', () => {
  it('admin_list_users RPCの結果を返す', async () => {
    const rows = [
      { ...adminProfile, email: 'admin@example.com', created_at: '2026-07-01T00:00:00Z' },
      {
        user_id: TARGET_ID,
        email: 'user@example.com',
        role: 'user',
        can_upload: true,
        can_process: false,
        can_chat: true,
        created_at: '2026-07-02T00:00:00Z',
      },
    ];
    dbHolder.client = fakeDb(
      { user_profiles: { data: adminProfile, error: null } },
      { admin_list_users: { data: rows, error: null } },
    );
    const res = await request('/v1/admin/users');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: unknown[] };
    expect(body.users).toEqual(rows);
  });
});

describe('PATCH /v1/admin/users/:id', () => {
  it('機能フラグを更新できる', async () => {
    dbHolder.client = fakeDb({
      user_profiles: [
        { data: adminProfile, error: null },
        {
          data: {
            user_id: TARGET_ID,
            role: 'user',
            can_upload: true,
            can_process: false,
            can_chat: true,
          },
          error: null,
        },
      ],
    });
    const res = await request(`/v1/admin/users/${TARGET_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ can_process: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { can_process: boolean } };
    expect(body.profile.can_process).toBe(false);
  });

  it('空bodyは422', async () => {
    dbHolder.client = fakeDb({ user_profiles: { data: adminProfile, error: null } });
    const res = await request(`/v1/admin/users/${TARGET_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('自分自身のadmin降格は422で拒否', async () => {
    dbHolder.client = fakeDb({ user_profiles: { data: adminProfile, error: null } });
    const res = await request(`/v1/admin/users/${ADMIN_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(422);
  });

  it('存在しないユーザーは404', async () => {
    dbHolder.client = fakeDb({
      user_profiles: [
        { data: adminProfile, error: null },
        { data: null, error: null },
      ],
    });
    const res = await request(`/v1/admin/users/${TARGET_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ can_chat: false }),
    });
    expect(res.status).toBe(404);
  });
});
