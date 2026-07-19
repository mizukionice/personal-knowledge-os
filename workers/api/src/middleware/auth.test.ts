import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';

import { createApp } from '../app';
import { clearJwksCache } from './auth';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'hs256-secret',
  GITHUB_DISPATCH_TOKEN: 'dummy',
  GITHUB_REPO: 'owner/repo',
};

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeEs256Keys(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey & {
    kid?: string;
    alg?: string;
  };
  publicJwk.kid = kid;
  publicJwk.alg = 'ES256';
  return { publicJwk, privateKey: pair.privateKey, kid };
}

/** Supabaseの実トークンと同じくkid付きヘッダでES256署名する */
async function signEs256(payload: object, privateKey: CryptoKey, kid: string): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(input),
    ),
  );
  return `${input}.${b64url(signature)}`;
}

const claims = { sub: 'es256-user', exp: Math.floor(Date.now() / 1000) + 3600 };

beforeEach(() => {
  clearJwksCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requireAuth JWKS (ES256)', () => {
  it('SupabaseのJWKSで署名検証しuser_idを返す', async () => {
    const { publicJwk, privateKey, kid } = await makeEs256Keys('key-1');
    const jwksFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ keys: [publicJwk] }),
    }));
    vi.stubGlobal('fetch', jwksFetch);

    const token = await signEs256(claims, privateKey, kid);
    const app = createApp();
    const res = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user_id: 'es256-user' });
    expect(jwksFetch).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    );
  });

  it('JWKSはキャッシュされ2回目のリクエストでfetchしない', async () => {
    const { publicJwk, privateKey, kid } = await makeEs256Keys('key-1');
    const jwksFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ keys: [publicJwk] }),
    }));
    vi.stubGlobal('fetch', jwksFetch);

    const token = await signEs256(claims, privateKey, kid);
    const app = createApp();
    const res1 = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );
    const res2 = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(jwksFetch).toHaveBeenCalledOnce();
  });

  it('JWKSに無い鍵で署名されたトークンは401', async () => {
    const { privateKey, kid } = await makeEs256Keys('key-1');
    const other = await makeEs256Keys('key-2');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [other.publicJwk] }) })),
    );

    const token = await signEs256(claims, privateKey, kid);
    const app = createApp();
    const res = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );
    expect(res.status).toBe(401);
  });

  it('HS256トークンは共有秘密鍵で検証される（フォールバック）', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const token = await sign({ ...claims, sub: 'hs256-user' }, 'hs256-secret');
    const app = createApp();
    const res = await app.request(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user_id: 'hs256-user' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
