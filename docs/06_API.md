# 06_API — API仕様（Cloudflare Workers / Hono）

- Base URL: `https://api.<domain>/v1`
- 認証: 全エンドポイント `Authorization: Bearer <Supabase JWT>` 必須
- エラー形式: `{ "error": { "code": "string", "message": "string" } }`
  - 401 `unauthorized` / 403 `forbidden` / 404 `not_found` / 422 `validation_error` / 429 `rate_limited` / 500 `internal`
- リクエスト/レスポンスのスキーマは `packages/shared` のzodで定義し、フロントと共有する

## Documents
- `POST /documents` — 作成。body: `{title, author?, doc_type}` → 201 `{document}`
- `GET /documents?status=&limit=&offset=` — 一覧（自分のもののみ）
- `GET /documents/:id` — 詳細（pages進捗サマリ含む）
- `DELETE /documents/:id` — 削除（DB cascade + R2オブジェクト削除）

## Upload
- `POST /documents/:id/upload-url` — body: `{file_name, content_type, page_number?}` → `{upload_url, r2_key}`（署名付きPUT URL、15分有効。画像10MB/PDF100MB制限はアップロード完了APIで検証）
- `POST /documents/:id/uploads/complete` — body: `{r2_keys: []}` — pages行を作成しstatus更新

## Processing
- `POST /documents/:id/process` — job作成 + GitHub repository_dispatch(`process_job`) → 202 `{job}`
- `GET /jobs?document_id=` — job一覧
- `GET /jobs/:id` — 進捗 `{status, progress, error?}`

## Content
- `GET /documents/:id/markdown` — 結合Markdown（R2から。`?page=n` で単ページ）
- `GET /documents/:id/concepts` — この本の概念一覧（mentions数付き）

## Knowledge（M3）
- `GET /search?q=` — Hybrid検索 → `{results: [{chunk_id, content, document_title, page_start, section_path, score}]}`
- `GET /concepts?q=&limit=` — 概念検索
- `GET /concepts/:id` — 概念詳細（定義一覧・出現書籍・関連概念1-hop）

## Chat（M4）
- `POST /chat` — body: `{message, history?}` → SSEストリーム。回答末尾にcitations配列 `[{document_id, title, page, section_path}]`

## Batch内部連携
- バッチはWorkers APIを経由せず、service roleで直接Supabase/R2にアクセスする（03_TDD §4）
- Workers→GitHub: `POST https://api.github.com/repos/{owner}/{repo}/dispatches` body `{event_type: "process_job", client_payload: {job_id}}`
