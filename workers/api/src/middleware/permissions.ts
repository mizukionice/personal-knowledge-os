import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { UserPermissionFlag, UserProfile } from '@pkos/shared';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

/**
 * 自分のuser_profiles行を取得しcontextにキャッシュする。
 * 行が無い場合はnull（トリガー導入前の既存ユーザー等）。
 */
export async function loadProfile(c: Context<AppEnv>): Promise<UserProfile | null> {
  const cached = c.get('profile');
  if (cached !== undefined) {
    return cached;
  }
  const { data, error } = await dbClient(c)
    .from('user_profiles')
    .select('user_id, role, can_upload, can_process, can_chat')
    .eq('user_id', c.get('userId'))
    .maybeSingle();
  if (error) {
    throw new ApiError('internal', `failed to fetch user profile: ${error.message}`);
  }
  const profile = (data as UserProfile | null) ?? null;
  c.set('profile', profile);
  return profile;
}

/**
 * 機能フラグが無効化されたユーザーを403で拒否する。
 * プロフィール行が無い場合は既定値（全機能許可）として扱う。
 */
export function requirePermission(flag: UserPermissionFlag) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const profile = await loadProfile(c);
    if (profile && !profile[flag]) {
      throw new ApiError('forbidden', `this account is not allowed to ${flag.slice('can_'.length)}`);
    }
    await next();
  });
}

/** 管理者（user_profiles.role = 'admin'）のみ許可する */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const profile = await loadProfile(c);
  if (!profile || profile.role !== 'admin') {
    throw new ApiError('forbidden', 'admin only');
  }
  await next();
});
