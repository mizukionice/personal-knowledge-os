# 03_TDD — Technical Design Document

## 1. システム構成

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

## 2. リポジトリ構成（pnpm workspace monorepo）

```
/
├── CLAUDE.md
├── README.md
├── docs/
├── apps/
│   └── web/                 # React SPA (Vite)
├── workers/
│   ├── api/                 # Cloudflare Workers (Hono)
│   └── batch/               # GitHub Actionsで実行するバッチランナー
├── packages/
│   ├── shared/              # 型定義・zodスキーマ（API/DB/KPS共通）
│   └── kps/                 # Knowledge Pipeline実装（コア。web/apiに依存しない）
├── supabase/
│   └── migrations/          # SQLマイグレーション
└── .github/workflows/
    ├── ci.yml               # lint + typecheck + test
    ├── deploy.yml           # Pages + Workers デプロイ
    └── process-job.yml      # バッチ処理（repository_dispatch: process_job）
```

ポイント: `packages/kps` は純粋なTypeScriptライブラリとして実装し、外部I/O（VLM API、DB）はインターフェース注入にする。ユニットテストが容易になり、KPSの差し替え可能性（04_KPS §2）を保証する。

## 3. 認証フロー
1. SPAはSupabase Auth（email+password）でログインし、JWTを取得
2. SPA→Workers APIへのリクエストは `Authorization: Bearer <jwt>`
3. WorkersはJWTを検証（SupabaseのJWT secret/JWKS）し、`user_id` を確定
4. DBアクセスは原則RLS有効のanonキー+ユーザーJWTで実行。バッチのみservice roleキー使用

## 4. アップロード〜処理フロー
1. `POST /documents` — ドキュメント（書籍）レコード作成
2. `POST /documents/:id/upload-url` — R2への署名付きアップロードURLを発行（ページ画像 or PDF）
3. クライアントがR2へ直接PUT（WorkersのCPU/メモリを経由しない）
4. `POST /documents/:id/process` — jobs行を作成（status=queued）し、GitHub `repository_dispatch` を送信
5. Actionsの `process-job.yml` が起動 → `workers/batch` 実行:
   - queuedなjobを取得（`FOR UPDATE SKIP LOCKED`）→ status=processing
   - PDFはページ画像に分解（pdf→png）
   - 各ページ: R2から画像取得 → PageAnalyzer(VLM) → PageAnalysis JSON → pages/R2保存
   - 全ページ完了後: Chunker → ConceptExtractor → RelationExtractor → Embedder → DB保存（KPS参照）
   - job status=completed / failed（エラー詳細をjobs.errorに記録）
6. SPAは `GET /jobs?document_id=` をポーリングして進捗表示

## 5. 冪等性・リトライ
- ページ処理は `pages.status` で管理し、失敗ページのみ再実行可能にする
- jobは同一documentで同時に1つ（DB unique制約: document_id + status in (queued, processing)）
- VLM API呼び出しは指数バックオフで3回リトライ。レート制限を考慮し並列度は設定値（デフォルト2）

## 6. セキュリティ
- 全テーブルRLS有効。`user_id = auth.uid()` ポリシー
- R2は非公開バケット。アクセスは署名付きURL（有効期限15分）のみ
- ファイルバリデーション: 拡張子+マジックバイト検査、上限 画像10MB / PDF100MB
- Workers APIにレート制限（IP+user単位、簡易実装で可）
- XSS: Markdownレンダリングはsanitize必須（rehype-sanitize）
- Secrets: Cloudflare（ANTHROPIC等は持たない。APIはR2/DB接続のみ）、GitHub Secrets（ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, CF_AI_TOKEN, R2キー）

## 7. 環境変数（.env.example を維持）
- web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`
- api: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `GITHUB_DISPATCH_TOKEN`, R2 binding
- batch: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CF_ACCOUNT_ID`, `CF_AI_TOKEN`, R2キー

## 8. デプロイ
- main へのpushで ci.yml → 成功時 deploy.yml（Pages: `apps/web`、Workers: `workers/api`）
- Supabaseマイグレーションは `supabase db push`（手動 or deploy.ymlの手動approvalステップ）
