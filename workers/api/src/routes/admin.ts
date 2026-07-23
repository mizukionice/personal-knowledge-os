import { Hono } from 'hono';
import { z } from 'zod';
import {
  updateAppSettingsRequestSchema,
  updateUserPermissionsRequestSchema,
} from '@pkos/shared';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const idSchema = z.uuid();

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError('validation_error', 'invalid JSON body');
  }
}

/** /admin/* — requireAdmin前提（app.tsで適用）。全操作はRLS（is_admin）でも二重に保護される */
export const adminRoute = new Hono<AppEnv>()
  // GET /admin/settings — サインアップ公開/停止の現在値
  .get('/settings', async (c) => {
    const { data, error } = await dbClient(c)
      .from('app_settings')
      .select('signup_enabled, updated_at')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to fetch settings: ${error.message}`);
    }
    if (!data) {
      throw new ApiError('internal', 'app settings row is missing');
    }
    return c.json({ settings: data });
  })

  // PUT /admin/settings — signup_enabled切り替え
  .put('/settings', async (c) => {
    const parsed = updateAppSettingsRequestSchema.safeParse(await parseJsonBody(c.req.raw));
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    const { data, error } = await dbClient(c)
      .from('app_settings')
      .update({ signup_enabled: parsed.data.signup_enabled, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('signup_enabled, updated_at')
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to update settings: ${error.message}`);
    }
    if (!data) {
      // RLSで更新できなかった（管理者でない）場合もここに落ちる
      throw new ApiError('forbidden', 'failed to update settings');
    }
    return c.json({ settings: data });
  })

  // GET /admin/users — 全ユーザーのemail+権限一覧（security definer RPC）
  .get('/users', async (c) => {
    const { data, error } = await dbClient(c).rpc('admin_list_users');
    if (error) {
      throw new ApiError('internal', `failed to list users: ${error.message}`);
    }
    return c.json({ users: data ?? [] });
  })

  // PATCH /admin/users/:id — role・機能フラグの更新
  .patch('/users/:id', async (c) => {
    const parsedId = idSchema.safeParse(c.req.param('id'));
    if (!parsedId.success) {
      throw new ApiError('validation_error', 'invalid user id');
    }
    const parsed = updateUserPermissionsRequestSchema.safeParse(await parseJsonBody(c.req.raw));
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    // 最後の管理者が自分を降格して誰も管理できなくなる事故を防ぐ
    if (parsedId.data === c.get('userId') && parsed.data.role === 'user') {
      throw new ApiError('validation_error', 'cannot demote your own admin role');
    }
    const { data, error } = await dbClient(c)
      .from('user_profiles')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('user_id', parsedId.data)
      .select('user_id, role, can_upload, can_process, can_chat')
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to update user permissions: ${error.message}`);
    }
    if (!data) {
      throw new ApiError('not_found', 'user not found');
    }
    return c.json({ profile: data });
  });
