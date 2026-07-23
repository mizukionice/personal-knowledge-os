import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { errorBody, handleError } from './errors';
import { requireAuth } from './middleware/auth';
import { rateLimit } from './middleware/rate-limit';
import { chatRoute } from './routes/chat';
import { conceptsRoute, documentConceptsRoute } from './routes/concepts';
import { contentRoute } from './routes/content';
import { documentsRoute } from './routes/documents';
import { jobsRoute, processRoute } from './routes/jobs';
import { searchRoute } from './routes/search';
import { uploadsRoute } from './routes/uploads';
import type { AppEnv } from './types';

/**
 * ALLOWED_ORIGIN（カンマ区切りの許可オリジン一覧）に一致するオリジンのみ許可する。
 * 未設定の場合は全オリジン拒否（fail-closed）。'*' を明示した場合のみ全許可（開発用）。
 */
function corsOriginResolver(allowedOrigin: string | undefined) {
  const allowed = (allowedOrigin ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return (origin: string): string | null =>
    allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : null;
}

/** テストごとに独立したrate limit状態を持てるようfactoryにしている */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(handleError);
  app.notFound((c) => c.json(errorBody('not_found', 'not found'), 404));

  app.use('*', (c, next) => cors({ origin: corsOriginResolver(c.env.ALLOWED_ORIGIN) })(c, next));

  // 死活監視用（認証不要）
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // /v1配下は全エンドポイント認証必須（06_API）
  const v1 = new Hono<AppEnv>();
  v1.use('*', requireAuth, rateLimit());

  // 認証確認・デバッグ用
  v1.get('/me', (c) => c.json({ user_id: c.get('userId') }));

  v1.route('/documents', documentsRoute);
  v1.route('/documents', uploadsRoute);
  v1.route('/documents', processRoute);
  v1.route('/documents', contentRoute);
  v1.route('/documents', documentConceptsRoute);
  v1.route('/jobs', jobsRoute);
  v1.route('/search', searchRoute);
  v1.route('/concepts', conceptsRoute);
  v1.route('/chat', chatRoute);

  app.route('/v1', v1);

  return app;
}
