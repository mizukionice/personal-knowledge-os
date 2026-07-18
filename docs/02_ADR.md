# 02_ADR — Architecture Decision Records

各ADRは「決定・理由・却下した代替案」を記録する。**Claude Codeはこれを勝手に変更しない。** 変更が必要と判断した場合は新しいADRを提案する。

## ADR-001: Frontend hosting = Cloudflare Pages
- 決定: React SPAをCloudflare Pagesでホスト
- 理由: Workers/R2と同一プラットフォームで設定・デプロイが簡単。無料枠十分。SPAルーティング対応
- 却下: GitHub Pages（動くが別プラットフォームで環境変数・プレビューが不便）

## ADR-002: API = Cloudflare Workers + Hono (TypeScript)
- 決定: REST APIをWorkers上のHonoで実装
- 理由: 無料枠が大きい、Edge低レイテンシ、TypeScript、R2ネイティブバインディング
- 却下: Supabase Edge Functions単独（R2バインディング不可）、常駐サーバー（コスト）

## ADR-003: DB/Auth = Supabase
- 決定: PostgreSQL + pgvector + Supabase Auth + RLS
- 理由: Auth/DB/ベクトル検索が1サービスで揃う。RLSでユーザー分離。無料枠十分
- 却下: Cloudflare D1（pgvector相当がない）、自前Auth（実装コスト・セキュリティリスク）

## ADR-004: Storage = Cloudflare R2
- 決定: 原本画像・PDF・生成MarkdownをR2に保存
- 理由: S3互換、egress無料、Workersネイティブバインディング
- 却下: Supabase Storage（可。ただしWorkersとの親和性でR2を優先）

## ADR-005: VLM = Claude API（インターフェース経由）
- 決定: ページ解析はClaude APIのvision機能で行う。`PageAnalyzer` インターフェースの背後に隠蔽し、モデル/プロバイダを設定で切替可能にする
- 理由: GitHub ActionsランナーにGPUがなく、Qwen2.5-VLセルフホストは非現実的（CPUでは1ページ数分以上）。APIなら書籍1冊数百円程度で高精度。日本語の書籍レイアウト理解に強い
- 代替: Gemini API（安価。`PageAnalyzer` 実装を1つ追加すれば切替可能）
- 将来: GPUクラウド(Modal等)でのQwen系セルフホストは、コストが問題になった時点で再検討

## ADR-006: Embedding = Cloudflare Workers AI `@cf/baai/bge-m3`
- 決定: embedding生成はWorkers AIのBGE-M3（1024次元）
- 理由: 多言語（日本語）性能、セルフホスト不要、安価、REST APIでActionsからも呼べる
- 却下: BGE-M3セルフホスト（GPU問題）、OpenAI embeddings（可。ベンダー分散を避けCloudflareに寄せる）

## ADR-007: バッチ処理 = GitHub Actions (TypeScript)
- 決定: 重い処理（VLM呼び出し・知識抽出）はGitHub Actionsで実行。Workerがジョブ登録後 `repository_dispatch` で起動。ランナーは `workers/batch` のTypeScriptスクリプト
- 理由: 無料枠2000分/月で個人利用に十分。長時間実行可（Workersは実行時間制限あり）。GPU不要になったため成立する構成
- 却下: Cloudflare Queues（有料プラン必須）、Python Worker（言語が2つになる。API呼び出し中心ならTSで十分）
- 注意: Actionsの秘密情報はGitHub Secretsで管理

## ADR-008: Knowledge Storage = 4表現を保持
- 決定: 1ドキュメントから Markdown（人間可読）/ JSON（構造）/ Embedding（検索）/ Graph（概念関係）の4表現を生成・保持する
- 理由: 用途が異なる（閲覧・再処理・検索・推論）。詳細はKPS参照

## ADR-009: 言語 = TypeScript一本化
- 決定: frontend / api / batch すべてTypeScript。pnpm workspaceのmonorepo
- 理由: 型・テスト・Lint設定を共有。Claude Codeの一貫性が上がる

## ADR-010: テスト = Vitest + Playwright
- 決定: unit/integrationはVitest、E2EはPlaywright（M5で導入）
- 理由: Vite系と親和性が高く設定が軽い
