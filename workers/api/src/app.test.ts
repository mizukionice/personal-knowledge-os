import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';

import { createApp } from './app';

const JWT_SECRET = 'test-jwt-secret';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  GITHUB_DISPATCH_TOKEN: 'dummy',
};

async function makeToken(overrides: Record<string, unknown> = {}) {
  return sign(
    {
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    },
    JWT_SECRET,
  );
}

describe('GET /health', () => {
  it('認証なしで200を返す', async () => {
    const app = createApp();
    const res = await app.request('/health', {}, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('認証ミドルウェア', () => {
  it('Authorizationヘッダなしは401 unauthorized', async () => {
    const app = createApp();
    const res = await app.request('/v1/me', {}, baseEnv);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('不正なトークンは401', async () => {
    const app = createApp();
    const res = await app.request(
      '/v1/me',
      { headers: { Authorization: 'Bearer not-a-jwt' } },
      baseEnv,
    );
    expect(res.status).toBe(401);
  });

  it('期限切れトークンは401', async () => {
    const app = createApp();
    const token = await makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );
    expect(res.status).toBe(401);
  });

  it('有効なトークンでuser_idが返る', async () => {
    const app = createApp();
    const token = await makeToken();
    const res = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user_id: 'user-1' });
  });
});

describe('エラー形式', () => {
  it('未知の/v1ルートは404 not_found（認証済み）', async () => {
    const app = createApp();
    const token = await makeToken();
    const res = await app.request(
      '/v1/no-such-route',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});

describe('rate limit', () => {
  it('上限を超えると429 rate_limitedを返す', async () => {
    const app = createApp();
    const env = { ...baseEnv, RATE_LIMIT_MAX: '2' };
    const token = await makeToken();
    const headers = { Authorization: `Bearer ${token}` };

    const res1 = await app.request('/v1/me', { headers }, env);
    const res2 = await app.request('/v1/me', { headers }, env);
    const res3 = await app.request('/v1/me', { headers }, env);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(429);
    const body = (await res3.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('ユーザーが異なればカウントは独立', async () => {
    const app = createApp();
    const env = { ...baseEnv, RATE_LIMIT_MAX: '1' };
    const tokenA = await makeToken({ sub: 'user-a' });
    const tokenB = await makeToken({ sub: 'user-b' });

    const resA1 = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${tokenA}` } },
      env,
    );
    const resA2 = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${tokenA}` } },
      env,
    );
    const resB1 = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${tokenB}` } },
      env,
    );

    expect(resA1.status).toBe(200);
    expect(resA2.status).toBe(429);
    expect(resB1.status).toBe(200);
  });
});
