# 10_RESEARCH — 研究採用記録と実験ログ

KPSの各コンポーネントについて「採用した手法・理由・将来の置き換え候補」を記録する。パイプライン変更時の実験結果もここに追記する（このファイルがプロンプト改善とアルゴリズム改善の実験ノートになる）。

## 採用済みプラクティス

| 手法 | 採用箇所 | 採用理由 | 置き換え候補 |
|---|---|---|---|
| Semantic Chunking（見出し/意味単位） | Chunker | 固定長より検索精度が高い | embedding類似度ベース分割 |
| Multi Representation（MD/JSON/Emb/Graph） | パイプライン全体 | 用途別に最適な表現が異なる | — |
| Hierarchical Knowledge（概念階層） | concepts.parent_concept_id | embeddingでは階層が失われる | — |
| Hybrid Retrieval（Vector+FTS+RRF） | Retriever | 単独手法より頑健。固有名詞に強い | ColBERT系 late interaction |
| Graph RAG（1-hop expansion） | Retriever | 「似た文」でなく「関連知識」を辿れる | Microsoft GraphRAG型のcommunity要約 |
| Context Compression | Reasoner | 長文をそのまま渡すと精度・コスト悪化 | 学習型compressor |
| Citation First | Reasoner | 専門用途では出典必須。ハルシネーション抑制 | — |
| Incremental Learning（差分更新） | MemoryUpdater | 全再構築はコスト・時間で破綻 | — |
| Concept中心Graph | ConceptExtractor | チャンク中心よりも知識の接続・矛盾検出が可能 | 専用NER/REモデル |

## 検証したい候補（バックログ）
- Late Interaction Retrieval（ColBERT/JaColBERT）: 日本語検索精度向上の可能性。embedding列の設計変更が必要
- GraphRAG community summary: 蔵書が50冊を超えたら「テーマ横断の要約」に有効か検証
- Contextual Retrieval（チャンクに文脈を前置してembedding）: 実装コスト低。M3後に最初に試す価値あり
- Reranker（bge-reranker等）: Hybrid検索の上位20件を並べ替え。Workers AIで利用可能か確認
- VLMプロンプトのfew-shot化: 図表の説明品質向上

## 実験ログ（追記式）

### テンプレート
```
日付: YYYY-MM-DD
対象: (例: PageAnalyzerプロンプト v1→v2)
仮説:
方法: (評価サンプル・指標)
結果:
判断: 採用 / 不採用 / 保留
```
