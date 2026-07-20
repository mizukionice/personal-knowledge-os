export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
  GITHUB_DISPATCH_TOKEN: string;
  /** repository_dispatch先の "owner/repo" */
  GITHUB_REPO: string;
  /** R2バケット（wrangler binding） */
  R2?: R2Bucket;
  /** Workers AI（検索クエリのembedding用） */
  AI?: Ai;
  /** R2 S3互換APIの署名用（wrangler secret） */
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  CF_ACCOUNT_ID: string;
  R2_BUCKET: string;
  /** Chat（M4）のClaude API呼び出し用（wrangler secret） */
  ANTHROPIC_API_KEY?: string;
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
