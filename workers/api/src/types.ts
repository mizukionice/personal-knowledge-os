export interface Env {
  SUPABASE_URL: string;
  SUPABASE_JWT_SECRET: string;
  GITHUB_DISPATCH_TOKEN: string;
  /** CORSで許可するオリジン。未設定なら "*"（開発用） */
  ALLOWED_ORIGIN?: string;
  /** rate limitの1分あたり上限。未設定なら60 */
  RATE_LIMIT_MAX?: string;
}

export interface Variables {
  /** JWT検証で確定したSupabaseユーザーID（auth.uid()相当） */
  userId: string;
  /** RLS付きDBアクセスに転送するための元のJWT */
  accessToken: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
