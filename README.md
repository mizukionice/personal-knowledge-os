# Personal Knowledge OS

知識の構造化エンジン。所有する専門書・PDF・写真をVLMで解析し、構造化された知識（Markdown / Concepts / Knowledge Graph / Embedding）へ変換して、長期的に育つ個人専用Knowledge Baseを構築するWebサービス。

## アーキテクチャ概要

```
[Browser SPA (React)]
   │ Supabase Auth (JWT)
   ▼
[Cloudflare Pages] ──→ [Cloudflare Workers API (Hono)]
                              │            │
                     [Supabase PG]      [R2 Storage]
                              │
                    repository_dispatch
                              ▼
                    [GitHub Actions: batch runner (TS)]
                       │        │         │
                  [Claude API] [Workers AI BGE-M3] [Supabase/R2 書き込み]
```

- **Frontend**: React + TypeScript + Vite → Cloudflare Pages
- **API**: Cloudflare Workers + Hono
- **DB/Auth**: Supabase（PostgreSQL + pgvector + Auth + RLS）
- **Storage**: Cloudflare R2
- **Batch**: GitHub Actions（`repository_dispatch` で起動するTSランナー）
- **VLM**: Claude API / **Embedding**: Workers AI `@cf/baai/bge-m3`

詳細は `docs/`（01_PRD 〜 09_DEVELOPMENT_RULES）を参照。

## リポジトリ構成

```
apps/web            React SPA（Vite + Tailwind + shadcn/ui + React Router）
workers/api         Cloudflare Workers API（Hono + JWT認証 + rate limit）
workers/batch       GitHub Actionsバッチランナー（M2で実装）
packages/shared     共有型・ユーティリティ（R2キー命名等）
packages/kps        Knowledge Pipeline System（M2以降で実装）
supabase/migrations DBマイグレーション（SQL）
```

## セットアップ

前提: Node.js 20以上、pnpm 11（`npm i -g pnpm`）

```sh
pnpm install

# 環境変数の準備（値は各サービスのダッシュボードから取得）
cp .env.example .env
```

### 開発コマンド

```sh
pnpm lint          # ESLint（リポジトリ全体）
pnpm format:check  # Prettier チェック（pnpm format で自動整形）
pnpm typecheck     # 全workspaceの型チェック
pnpm test          # 全workspaceのテスト（Vitest）

pnpm --filter @pkos/web dev      # web開発サーバー（http://localhost:5173）
pnpm --filter @pkos/web build    # web本番ビルド（dist/）
pnpm --filter @pkos/api dev      # API開発サーバー（wrangler dev, http://localhost:8787）
```

#### E2Eテスト（Playwright）

`web`（:5173）と`api`（:8787）の両dev serverを起動した状態で実行する。
実Supabase/R2/Workers AIに対して動くため `.env` が必要（テスト用ユーザーを
自動作成・シードし、終了時に削除する。実データには触れない）。

```sh
pnpm --filter @pkos/web exec playwright install chromium  # 初回のみ
pnpm --filter @pkos/web e2e
```

APIのローカル開発では `workers/api/.dev.vars`（gitignore済み）にsecretsを置く:

```
SUPABASE_JWT_SECRET=...   # Supabaseダッシュボード > Settings > API > JWT Secret
GITHUB_DISPATCH_TOKEN=... # M2で使用
ANTHROPIC_API_KEY=...     # M4 Chat（/chat）で使用
```

### Supabase

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. マイグレーション（`supabase/migrations/`）を適用。DBパスワード（`.env` の `SUPABASE_DB_PASSWORD`）があればlink不要:
   ```sh
   pnpm dlx supabase db push --db-url "postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres"
   ```
   （または `supabase link --project-ref <project-ref> && supabase db push`）
4. `.env` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 等をダッシュボードの値で埋める

スキーマ定義は `docs/05_DATABASE.md`、実体は `supabase/migrations/` のSQL。変更は必ず新しいmigrationファイルで行う。

## 本番デプロイ / 運用

デプロイ対象は3つ: **API（Cloudflare Workers）**、**Web（Cloudflare Pages）**、**バッチ（GitHub Actions）**。

### 1. Workers APIのsecrets（初回のみ / 値変更時）

`[vars]`（`wrangler.toml`）は公開値。秘密値は `wrangler secret put` で登録する:

```sh
cd workers/api
for s in SUPABASE_JWT_SECRET GITHUB_DISPATCH_TOKEN R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY ANTHROPIC_API_KEY; do
  npx wrangler secret put "$s"   # プロンプトに値を貼り付け
done
```

### 2. Cloudflare Pagesプロジェクト（初回のみ）

```sh
cd apps/web
npx wrangler pages project create pkos-web --production-branch main
```

`ALLOWED_ORIGIN`（`wrangler.toml`）はCORS許可オリジンのカンマ区切りリスト。既定は本番Pagesドメインのみで、**未設定の場合は全オリジン拒否（fail-closed）**。ローカル開発は `workers/api/.dev.vars` に `ALLOWED_ORIGIN=http://localhost:5173,http://127.0.0.1:5173` を設定する。

### 3. デプロイ

- **手動（ローカル）**: `pnpm --filter @pkos/api exec wrangler deploy` / `pnpm --filter @pkos/web build && pnpm --filter @pkos/web exec wrangler pages deploy dist --project-name pkos-web`
- **GitHub Actions**: `Deploy` ワークフローを手動起動（`workflow_dispatch`、対象 both/api/web を選択）

`Deploy` ワークフローに必要な **GitHub Secrets**:
`CLOUDFLARE_API_TOKEN`（Workers Scripts:Edit + Pages:Edit）、`CLOUDFLARE_ACCOUNT_ID`、
`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_API_BASE_URL`（本番APIのURL）。

### 4. バッチ（`Process Job` ワークフロー）のsecrets

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` / `CF_ACCOUNT_ID` /
`CF_AI_TOKEN` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` をリポジトリのActions Secretsに設定する。

### 5. アクセス制御（サインアップ公開/停止・ユーザー権限）

マイグレーション `20260723000001_admin_access_control.sql` 適用後:

1. **最初の管理者を昇格**（Supabase SQL Editorで1回だけ実行）:
   ```sql
   update user_profiles set role = 'admin'
   where user_id = (select id from auth.users where email = '<あなたのemail>');
   ```
2. **サインアップの公開/停止**: Settings画面の管理者パネル、または `PUT /v1/admin/settings`。
   停止中はDBトリガーが `auth.users` へのinsertを拒否するため、Auth APIを直接叩いても登録できない
3. **ユーザーごとの機能制御**: 管理者パネルで `can_upload / can_process / can_chat` を切替。
   無効化された機能のAPIは403を返す（VLM処理・チャットのAnthropic費用をユーザー単位で遮断できる）

### コスト

1冊あたりのAnthropic APIコストはバッチ完了時にActionsログの `[cost]` 行へ出力される（`UsageMeter`）。
実測値は `docs/10_RESEARCH.md` を参照。

## 進捗

- [x] **M0: Project Setup** — monorepo / Lint・型・テスト基盤 / CI / DBスキーマ
- [x] **M1: Auth + Upload** — ログイン/認証ガード / documents CRUD / R2署名付きURLアップロード / Library・Upload画面
      （完了条件の実機確認にはSupabase/R2の実プロジェクト設定が必要。`.env` と `workers/api/.dev.vars` を参照）
- [x] **M2: Processing Pipeline** — 完了。青空文庫PDFに加え、写真撮影した実書籍10ページ（専門書）でも
      E2E検証済み（M2-09。実験ログはdocs/10_RESEARCH.md）
- [x] M3: Knowledge化 + 検索 — 完了（M3-09: 3冊処理で「芥川龍之介」「青空文庫」の概念横断同定を確認）
- [x] M4: 引用付きチャット — 完了（蔵書内2問・蔵書外1問で出典の正確性とハルシネーション無しを確認）
- [x] M5: Hardening — Playwright E2E / セキュリティ確認 / コスト計測（1冊約$1.84）/ deploy.yml・運用手順
      （本番ライブデプロイは上記「本番デプロイ / 運用」に沿ってユーザーが手動実行）
- [x] M5-05〜07: セキュリティ強化 — CORS allowlist化（fail-closed）/ signup公開・停止（管理者切替、DBトリガーで強制）/
      ユーザーごとの機能権限（can_upload・can_process・can_chat）と管理者パネル

タスク詳細は `docs/08_TASKS.md`。
