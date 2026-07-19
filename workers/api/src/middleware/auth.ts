import { createMiddleware } from 'hono/factory';
import { decode, verify, verifyWithJwks } from 'hono/jwt';
import type { HonoJsonWebKey } from 'hono/utils/jwt/jws';

import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache: { uri: string; keys: HonoJsonWebKey[]; fetchedAt: number } | null = null;

/** テスト用: モジュールスコープのJWKSキャッシュを破棄する */
export function clearJwksCache(): void {
  jwksCache = null;
}

async function getJwks(uri: string): Promise<HonoJsonWebKey[]> {
  if (jwksCache && jwksCache.uri === uri && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`failed to fetch JWKS: status ${response.status}`);
  }
  const body = (await response.json()) as { keys?: HonoJsonWebKey[] };
  jwksCache = { uri, keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

/**
 * Supabase JWTを検証し userId / accessToken をセットする（TDD §3: JWT secret/JWKS）。
 * - 新方式（JWT Signing Keys, ES256等）: SupabaseのJWKSエンドポイントで検証
 * - 旧方式（Legacy HS256共有秘密鍵）: SUPABASE_JWT_SECRET で検証
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError('unauthorized', 'missing bearer token');
  }
  const token = header.slice('Bearer '.length);

  let sub: unknown;
  try {
    const alg = decode(token).header?.alg;
    const payload =
      alg === 'HS256'
        ? await verify(token, c.env.SUPABASE_JWT_SECRET, 'HS256')
        : await verifyWithJwks(token, {
            keys: await getJwks(`${c.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
            allowedAlgorithms: ['ES256', 'RS256'],
          });
    sub = payload.sub;
  } catch {
    throw new ApiError('unauthorized', 'invalid or expired token');
  }
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new ApiError('unauthorized', 'token has no subject');
  }

  c.set('userId', sub);
  c.set('accessToken', token);
  await next();
});
