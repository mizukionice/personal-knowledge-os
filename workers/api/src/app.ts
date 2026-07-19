import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { errorBody, handleError } from './errors';
import { requireAuth } from './middleware/auth';
import { rateLimit } from './middleware/rate-limit';
import { documentsRoute } from './routes/documents';
import type { AppEnv } from './types';

/** テストごとに独立したrate limit状態を持てるようfactoryにしている */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(handleError);
  app.notFound((c) => c.json(errorBody('not_found', 'not found'), 404));

  app.use('*', (c, next) => cors({ origin: c.env.ALLOWED_ORIGIN ?? '*' })(c, next));

  // 死活監視用（認証不要）
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // /v1配下は全エンドポイント認証必須（06_API）
  const v1 = new Hono<AppEnv>();
  v1.use('*', requireAuth, rateLimit());

  // 認証確認・デバッグ用
  v1.get('/me', (c) => c.json({ user_id: c.get('userId') }));

  v1.route('/documents', documentsRoute);

  app.route('/v1', v1);

  return app;
}
