import { createMiddleware } from 'hono/factory';

import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * IP+user単位の固定ウィンドウrate limit（TDD §6「簡易実装で可」）。
 * 状態はisolateローカルのMap。厳密な分散制限が必要になったら
 * Durable Objects / KV への置き換えを検討する。
 */
export function rateLimit() {
  const buckets = new Map<string, Bucket>();

  return createMiddleware<AppEnv>(async (c, next) => {
    const max = Number(c.env.RATE_LIMIT_MAX ?? DEFAULT_MAX);
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const key = `${ip}:${c.get('userId') ?? ''}`;
    const now = Date.now();

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    } else {
      bucket.count += 1;
      if (bucket.count > max) {
        throw new ApiError('rate_limited', 'too many requests');
      }
    }
    await next();
  });
}
