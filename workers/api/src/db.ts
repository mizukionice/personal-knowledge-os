import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

import type { AppEnv } from './types';

/**
 * RLS有効のanonキー + ユーザーJWTでSupabaseにアクセスするクライアント（TDD §3）。
 * user_id分離はRLSポリシーに委ねる。
 */
export function dbClient(c: Context<AppEnv>): SupabaseClient {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${c.get('accessToken')}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
