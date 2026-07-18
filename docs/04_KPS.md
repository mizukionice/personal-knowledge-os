# 04_KPS — Knowledge Pipeline Specification

**このドキュメントがプロダクトの核であり知的財産である。** 実装はすべて `packages/kps` に置き、各ステージをインターフェースとして定義する。研究の進展に応じてコンポーネント単位で差し替える。

## 1. 設計思想
- 「AIに知識を保存する」のではなく「AIの知識形成プロセスを設計する」
- 一般的なRAG（PDF→チャンク→ベクトル検索）で終わらせない。概念中心のKnowledge Graphを構築し、知識が本を横断して接続・成長する
- 5層モデル: Document → Semantic Structure → Knowledge → Memory → Reasoning

## 2. パイプラインとインターフェース

```
[Input: page images / PDF]
  → DocumentParser      # PDF→ページ画像分解、メタデータ抽出
  → PageAnalyzer        # VLM: OCR+レイアウト+図表理解 → PageAnalysis
  → Chunker             # Semantic Chunking → Chunk[]
  → ConceptExtractor    # 概念抽出+正規化 → Concept[]
  → RelationExtractor   # 概念間関係 → Relation[]
  → Embedder            # BGE-M3 → vector(1024)
  → MemoryUpdater       # 既存Knowledge Baseへの統合（差分更新）
  → Retriever           # Hybrid Retrieval（M3）
  → Reasoner            # 引用付き回答生成（M4）
```

各ステージはTypeScriptインターフェース（`packages/kps/src/interfaces.ts`）。MVP実装:

| Interface | MVP実装 | 将来の差し替え候補 |
|---|---|---|
| PageAnalyzer | Claude API vision | Gemini / Qwen-VLセルフホスト |
| Chunker | 見出しベース+意味境界 | 埋め込みベースsemantic chunking |
| ConceptExtractor | LLM抽出+正規化ルール | 専用NERモデル |
| Embedder | Workers AI BGE-M3 | ColBERT系 late interaction |
| Retriever | vector+FTS+graph 1-hop | GraphRAG本格実装 |
| Reasoner | Claude API + context compression | 推論キャッシュ・エージェント化 |

## 3. PageAnalyzer（VLM）仕様
入力: ページ画像1枚（+前ページの文脈要約）。出力は次のJSONスキーマ（zodで検証、`packages/shared`）:

```jsonc
{
  "markdown": "ページ全文の構造化Markdown",   // 見出しレベル維持、図表は下記参照で埋め込み
  "page_type": "content | toc | cover | index | blank",
  "sections": [{ "level": 2, "title": "3.2 リスク対応戦略" }],
  "figures": [{ "id": "fig-1", "caption": "図3-2 リスクマトリクス",
                "description": "発生確率と影響度の2軸で..." }],   // VLMによる図の説明文
  "tables":  [{ "id": "tbl-1", "caption": "...", "markdown": "| ... |" }],  // 表はMarkdown表に変換
  "formulas": [{ "latex": "EV = \\sum p_i x_i", "explanation": "..." }],
  "concepts": [{ "name": "EVM", "name_ja": "アーンドバリューマネジメント",
                 "definition": "このページでの定義・説明の要約",
                 "importance": 0.8 }],
  "context_summary": "次ページへ渡す3文以内の文脈要約"
}
```

プロンプト要件:
- 「文字起こし」ではなく「ページの理解」を指示する（図は説明文に、表はMarkdown表に、強調・脚注は保持）
- 概念は固有名詞・専門用語・手法名のみ。一般語は抽出しない
- 出力はJSONのみ。パース失敗時は1回だけ修復リトライ
- プロンプト本文は `packages/kps/src/prompts/` に置き、バージョン番号を付けて管理する（実験結果は10_RESEARCH.mdに記録）

## 4. Chunker — Semantic Chunking
固定長分割は使わない。規則:
1. 第一分割: セクション（見出し）単位。`sections` 情報を使用
2. セクションが長い場合（>1500字）: 段落境界で分割。段落間の話題転換はLLM出力の見出し・接続詞を手掛かりに保守的に判定
3. 短すぎるセクション（<200字）は次セクションと結合しない（見出しの意味を保つ）。ただし単独で意味を成さない場合は前チャンクに併合
4. 各チャンクは必ず保持する: `document_id, page_start, page_end, section_path（例: "第3章 > 3.2 リスク対応"）, chunk_type(text|figure|table)`
5. 図・表はキャプション+説明文で独立チャンクにする（図表検索を可能にするため）

## 5. ConceptExtractor — 概念抽出と正規化
- 入力: PageAnalysisの `concepts[]`（ページ単位）を書籍単位で集約
- 正規化: (1) 表記ゆれ統合（英名/和名/略称 → canonical name + aliases[]）、(2) 既存conceptsテーブルとの照合
- 既存概念との同定は2段階: ① canonical name / aliasの完全一致 → ② embedding類似度 > 0.90 かつ LLMに同一性を確認（Yes/No）
- 同定された場合は新規作成せず、既存conceptに `concept_mentions`（出現箇所）を追加し、definitionを必要に応じて更新（Memory Update）
- 概念は階層を持てる: `parent_concept_id`（例: リスク管理 > 定量的リスク分析）

## 6. RelationExtractor — 関係抽出
関係タイプ（MVP、これ以外は追加しない）:
- `is_a` （上位下位）
- `part_of` （構成要素）
- `relates_to` （関連。デフォルト）
- `contradicts` （矛盾・対立する主張。**本プロダクトの差別化要素**）
- `same_as` （別名・同一概念。正規化で解決できなかった場合）

抽出方法: 書籍処理の最後に、その本の概念リスト+各定義をLLMに渡し、関係トリプル `(source, relation, target, evidence_chunk_id)` を抽出。**evidence（根拠チャンク）のない関係は保存しない。**

## 7. Multi Representation（ADR-008）
1ページ/1書籍から生成・保存するもの:
- **Markdown**: R2 (`{user}/{doc}/pages/{n}.md` と結合版 `full.md`) — 閲覧・エクスポート用
- **JSON** (PageAnalysis): R2 — 再処理・パイプライン改良時の再実行用（VLM再呼び出し不要にする）
- **Embedding**: chunks.embedding — 検索用
- **Graph** (concepts + concept_links): DB — 推論・横断接続用

## 8. Retriever — Hybrid Retrieval（M3）
1. Vector: pgvector cosine, top 20
2. Keyword: PostgreSQL FTS + pg_trgm, top 20
3. RRF（Reciprocal Rank Fusion）で統合 → top 10
4. Graph expansion: ヒットしたチャンクに紐づく概念の1-hop先の概念から、関連チャンクを最大5件追加
5. 返却は常に citation情報付き: `{chunk, document_title, page_start, section_path, score}`

## 9. Reasoner — Citation First（M4）
- Context Compression: 検索結果チャンクをそのまま渡さず、質問との関連部分を優先し合計8000トークン以内に絞る
- 回答には必ず出典を付ける: `[書名 p.145 §3.2]` 形式。出典のない主張をさせないようプロンプトで強制
- 蔵書に根拠がない場合は「あなたのライブラリにはこの情報がありません」と明示（一般知識で答える場合は区別を明記）

## 10. MemoryUpdater — 知識の成長（差分更新）
- 新しい本の処理時、全体の再embedding・再構築はしない。追加分のみ処理（Incremental Learning）
- 既存概念に新しい言及が追加されたら: mention数と出現書籍数から `importance` を再計算
- `contradicts` 関係が新たに検出されたら記録し、UI上でユーザーに提示できるようにする（M4以降）
- 概念の定義は「最新の本で上書き」ではなく「出典付きで併記」する（どの本がどう定義したかを保持）

## 11. 品質評価
パイプライン変更時は `packages/kps/eval/` の固定サンプル（自炊した書籍ページ5〜10枚）で回帰確認する:
- Markdown化の目視diff
- 概念抽出の期待リストとの一致率
- チャンク数・境界の妥当性
結果は10_RESEARCH.mdに記録。
