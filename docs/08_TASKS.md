# 08_TASKS — 実装ロードマップ

Claude Codeへの指示: **1マイルストーンずつ実装し、完了条件を満たしてから次へ進む。** Task単位でcommit（例: `M2-03: ...`）。完了したタスクは `[x]` に更新する。

## M0: Project Setup
- [x] M0-01 pnpm workspace monorepo初期化（apps/web, workers/api, workers/batch, packages/shared, packages/kps）
- [x] M0-02 TypeScript / ESLint / Prettier 共通設定、Vitest導入
- [x] M0-03 CI（.github/workflows/ci.yml: lint + typecheck + test）
- [x] M0-04 README.md（アーキテクチャ概要・セットアップ手順）、.env.example
- [x] M0-05 Supabaseプロジェクト接続設定 + migrationsディレクトリ + 05_DATABASEのDDL適用
- 完了条件: `pnpm lint && pnpm typecheck && pnpm test` が全workspaceで通る。CIがgreen

## M1: Auth + Upload
- [x] M1-01 web: Vite + React + Tailwind + shadcn/ui セットアップ、ルーティング
- [x] M1-02 web: Login/Signup画面（Supabase Auth）、セッション管理、認証ガード
- [x] M1-03 api: Hono + JWT検証ミドルウェア + エラーハンドラ + rate limit
- [x] M1-04 api: documents CRUD（POST/GET/DELETE）
- [x] M1-05 api: upload-url発行（R2署名付きURL）+ uploads/complete
- [x] M1-06 web: Library画面（一覧・削除）
- [x] M1-07 web: Upload画面（複数写真・PDF、並び替え、進捗、リトライ）
- [ ] M1-E2E ブラウザで完了条件を実機確認（`wrangler login` 後、remote R2バインディングで
      サインアップ→ログイン→アップロード→Library表示を通す。Supabase/R2接続・署名PUTは検証済み）
- 完了条件: ログインし、写真をアップロードし、Libraryに書籍が並ぶ（処理はまだ）

## M2: Processing Pipeline（最初の価値: 写真→Markdown）
- [x] M2-01 kps: interfaces.ts（KPS §2の全インターフェース）+ PageAnalysis zodスキーマ
- [x] M2-02 kps: DocumentParser（PDF→ページ画像。pdfjs or mupdf）
- [ ] M2-03 kps: PageAnalyzer Claude API実装 + プロンプトv1（KPS §3）+ モックを使ったunit test
- [ ] M2-04 batch: ジョブランナー（job取得→ページ順次処理→R2/DB保存→進捗更新→エラー処理）
- [ ] M2-05 api: POST /documents/:id/process + repository_dispatch、GET /jobs
- [ ] M2-06 .github/workflows/process-job.yml
- [ ] M2-07 web: 処理進捗表示（ポーリング）、失敗ページの再実行
- [ ] M2-08 web: Document Viewer（Markdown表示 + sanitize + 目次）
- [ ] M2-09 実書籍でE2E検証: 10ページ処理し、Markdown品質を目視確認 → 結果を10_RESEARCH.mdに記録
- 完了条件: 本の写真をアップ→数分後に構造化Markdownが読める

## M3: Knowledge化 + 検索
- [ ] M3-01 kps: Chunker（KPS §4）+ unit test（境界ケース含む）
- [ ] M3-02 kps: Embedder（Workers AI BGE-M3）
- [ ] M3-03 kps: ConceptExtractor（集約・正規化・既存照合、KPS §5）
- [ ] M3-04 kps: RelationExtractor（KPS §6、evidence必須）
- [ ] M3-05 batch: M2パイプラインにM3ステージを接続
- [ ] M3-06 db: search_chunks RPC（Hybrid + RRF）
- [ ] M3-07 api: GET /search, /concepts, /concepts/:id, /documents/:id/concepts
- [ ] M3-08 web: Search画面、Concept詳細画面、Viewer概念サイドバー
- [ ] M3-09 検証: 2冊以上処理し、概念の横断リンク（同一概念の同定）が機能することを確認
- 完了条件: 書名を思い出せなくても内容で検索でき、概念が本を横断してつながる

## M4: 引用付きチャット
- [ ] M4-01 kps: Retriever（graph expansion含む、KPS §8）
- [ ] M4-02 kps: Reasoner（context compression + citation強制、KPS §9）
- [ ] M4-03 api: POST /chat（SSE）
- [ ] M4-04 web: Chat画面（citationリンク→Viewer遷移）
- [ ] M4-05 検証: 蔵書にある質問/ない質問の両方で挙動確認（出典の正確性、ハルシネーション有無）
- 完了条件: 自分の蔵書を根拠に、出典ページ付きで回答が返る

## M5: Hardening
- [ ] M5-01 E2Eテスト（Playwright: ログイン→アップロード→閲覧→検索）
- [ ] M5-02 セキュリティ確認（RLS全テーブル、R2非公開、sanitize、rate limit）
- [ ] M5-03 コスト計測（1冊あたりVLM/embedding費用をログから集計）
- [ ] M5-04 deploy.yml整備、本番デプロイ、READMEの運用手順化
