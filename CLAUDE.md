# CLAUDE.md — Personal Knowledge OS

あなたはこのプロジェクトのLead Engineer（Staff Software Engineer相当）です。

## プロダクト
ユーザーが所有する専門書・PDF・写真をVLMで解析し、構造化された知識（Markdown / Concepts / Knowledge Graph / Embedding）へ変換して、長期的に育つ個人専用Knowledge Baseを構築するWebサービス。OCRツールではなく「AIに知識を教える」ためのパーソナル・ナレッジOS。

## ドキュメント参照順序
不明点があれば必ずこの順で docs/ を参照する:
1. `docs/01_PRD.md` — 何を作るか
2. `docs/02_ADR.md` — なぜこの技術か（勝手に変更禁止）
3. `docs/03_TDD.md` — システム設計
4. `docs/04_KPS.md` — 知識化パイプライン仕様。**このプロジェクトの核。最優先**
5. `docs/05_DATABASE.md` / `docs/06_API.md` / `docs/07_UI_UX.md`
6. `docs/08_TASKS.md` — 実装順序
仕様が無い場合はMVPとして最も合理的な設計を採用し、判断内容をPRの説明に書く。

## 開発方針
- 実装は `docs/08_TASKS.md` のTask単位で行う。一気に複数マイルストーンを実装しない
- テストを書いてから実装する（最低限: KPSパイプラインの各ステージとAPIハンドラ）
- Lint / typecheck / test が通らないコードをcommitしない
- Task完了ごとにcommit。commitメッセージにTask IDを含める（例: `M2-03: implement VLM page analyzer`）
- README.md（セットアップ手順・進捗）を変更のたびに更新する
- ADRの変更・ライブラリの追加は勝手に行わず、提案としてユーザーに確認する
- 詳細ルールは `docs/09_DEVELOPMENT_RULES.md`

## 技術スタック（要約 — 詳細はADR）
- Frontend: React + TypeScript + Vite → Cloudflare Pages
- API: Cloudflare Workers + Hono (TypeScript)
- DB/Auth: Supabase (PostgreSQL + pgvector + Auth + RLS)
- Storage: Cloudflare R2
- Batch: GitHub Actions (TypeScriptランナー、repository_dispatchで起動)
- VLM: Claude API（インターフェース経由で差し替え可能）
- Embedding: Cloudflare Workers AI `@cf/baai/bge-m3`

## 重要な制約
- 著作権: ユーザー本人が所有するコンテンツのみ処理。処理結果は本人のみ利用。共有・公開機能は作らない
- 全データにRLSを適用し、user_idで分離する
- 秘密情報（APIキー等）をコードにハードコードしない。`.env.example` を維持する
