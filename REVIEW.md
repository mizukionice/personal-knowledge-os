# GPT案レビュー — 修正点と理由

GPT案の全体構成（PRD→ADR→TDD→KPS→Tasks、KPSをコアIPとする発想）は良い。以下の修正を加えた。

## 修正した点

### 1. VLMセルフホスト（Qwen2.5-VL on GitHub Actions）→ VLM APIに変更【最重要】
GitHub ActionsのランナーにはGPUがない。Qwen2.5-VL級のモデルはCPUでは1ページ数分〜数十分かかり実用不可。GPUクラウド(Modal/RunPod)案もあるが、個人用MVPではコスト・構築負荷が見合わない。
→ **Claude API（代替: Gemini API）を採用**。書籍1冊(300ページ)の処理コストは数百円程度。精度もセルフホストより高い。KPSでVLMをインターフェース化するので、将来セルフホストへ差し替え可能。

### 2. Docling / EasyOCR → MVPでは不要
VLM APIはOCR+レイアウト理解+図表理解を1パスで行える。OCR→VLMの2段構成はセルフホスト前提の設計。MVPは「ページ画像→VLM→構造化Markdown+概念JSON」の1段に簡素化。実装量が半減する。

### 3. BGE-M3セルフホスト → Cloudflare Workers AI
Workers AIに `@cf/baai/bge-m3` があり、同じモデルをAPI経由で安価に使える。GPU不要。

### 4. Python Worker廃止 → TypeScript一本化
GPT案は Workers(TS) + Python Worker の2言語構成。API呼び出しだけならPythonは不要。全コードをTypeScriptに統一し、Claude Codeの実装・テストの一貫性を上げる。

### 5. GitHub Pages → Cloudflare Pages
どちらでも動くが、Workers・R2と同一プラットフォームの方が設定・デプロイが簡単。SPAルーティングも素直に動く。

### 6. MVPスコープ削減
- テーブル: 10 → 7（Tags・ReadingHistory・独立Embeddingsテーブルは後回し。embeddingはchunksの列に持つ）
- タスク: 100〜150 → 約45。個人用MVPに150タスクは過剰。動くものを早く出し、使いながら育てる
- **引用付き簡易チャットをM4に昇格**。GPT案はチャットをスコープ外にしていたが、「知識を使って回答する」体験こそ価値証明。ここまで作らないと継続動機が生まれない

### 7. 00_SYSTEM_PROMPT.md → CLAUDE.mdに統合
Claude Codeが自動で読むのはCLAUDE.md。役割・ルールを2ファイルに分けると乖離するため統合。

## 変更しなかった点（GPT案を採用）
- PRD → ADR → TDD → KPS → Tasks のドキュメント駆動構成
- KPSを差し替え可能なインターフェース群として定義する方針
- Multi Representation（Markdown/JSON/Embedding/Graph）、Semantic Chunking、Citation First、Hybrid Retrieval
- Supabase（Auth + Postgres + pgvector + RLS）
- 著作権前提: 自分が所有する書籍のみ・本人のみ利用・コンテンツ非公開

## 進め方の推奨
1. このフォルダをGitリポジトリのルートに置き、Claude Codeを起動
2. 「docs/08_TASKS.md の M0 から進めて」と指示。**1マイルストーンずつ**進め、動作確認してから次へ
3. 最初の成功体験はM2完了時点の「本の写真をアップ→構造化Markdownが返る」。まずここを目指す
4. 概念抽出プロンプト（KPS §5）は実際の本で試して育てる。実験結果は docs/10_RESEARCH.md に記録
