import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';

import { ApiError } from '../errors';
import type { AppEnv } from '../types';

/** Supabase JWT（HS256, SUPABASE_JWT_SECRET）を検証し userId / accessToken をセットする */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError('unauthorized', 'missing bearer token');
  }
  const token = header.slice('Bearer '.length);

  let sub: unknown;
  try {
    const payload = await verify(token, c.env.SUPABASE_JWT_SECRET, 'HS256');
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
