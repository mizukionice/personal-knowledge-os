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

APIのローカル開発では `workers/api/.dev.vars`（gitignore済み）にsecretsを置く:

```
SUPABASE_JWT_SECRET=...   # Supabaseダッシュボード > Settings > API > JWT Secret
GITHUB_DISPATCH_TOKEN=... # M2で使用
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

## 進捗

- [x] **M0: Project Setup** — monorepo / Lint・型・テスト基盤 / CI / DBスキーマ
- [x] **M1: Auth + Upload** — ログイン/認証ガード / documents CRUD / R2署名付きURLアップロード / Library・Upload画面
      （完了条件の実機確認にはSupabase/R2の実プロジェクト設定が必要。`.env` と `workers/api/.dev.vars` を参照）
- [x] **M2: Processing Pipeline** — 完了。青空文庫PDFに加え、写真撮影した実書籍10ページ（専門書）でも
      E2E検証済み（M2-09。実験ログはdocs/10_RESEARCH.md）
- [x] M3: Knowledge化 + 検索 — 完了（M3-09: 3冊処理で「芥川龍之介」「青空文庫」の概念横断同定を確認）
- [ ] M4: 引用付きチャット
- [ ] M5: Hardening

タスク詳細は `docs/08_TASKS.md`。
