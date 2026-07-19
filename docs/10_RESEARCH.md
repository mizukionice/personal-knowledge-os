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

```
日付: 2026-07-20
対象: M3 Knowledge化パイプライン初回検証（Chunker/Embedder/ConceptExtractor/RelationExtractor v1）
仮説: 処理済み書籍の再実行でKnowledge化ステージのみが走り、チャンク・概念・関係が正しく保存される
方法: 「蜘蛛の糸」を再処理（ページはスキップ、Knowledge化のみ実行）し、DB内容と検索を確認
結果:
- chunks: 5件。section_pathが「蜘蛛の糸 > 一/二/三」と章構造を正しく反映
- concepts: 8件。表記ゆれ統合が機能（犍陀多/かんだた、御釈迦様/おしゃかさま がalias化）。
  importanceも妥当（主要人物0.8-0.9、出典情報0.3-0.4）
- concept_links: 6件（relates_to、全てevidence付き）
- Hybrid検索: クエリ「地獄に落ちた男が細い糸にすがって登っていく場面」のトップヒットが
  「蜘蛛の糸 > 二」（該当場面）。セマンティック検索が機能
判断: v1プロンプト採用。文学作品では人物名が概念抽出されるが、専門書での用語抽出精度と
      2冊以上での概念横断リンク（M3-09）は次の検証で確認
```

```
日付: 2026-07-19
対象: M2パイプラインE2E初回検証（PageAnalyzerプロンプト v1 / claude-opus-4-8）
仮説: アップロード→Actions→VLM解析→Markdown表示が一気通貫で動作し、実用品質のMarkdownが得られる
方法: 青空文庫「蜘蛛の糸」（芥川龍之介）PDF 2ページをブラウザからアップロードし全工程を実行、目視確認
結果:
- 2/2ページ completed、job所要1分53秒（PDF分解→PNG化→VLM解析2ページ含む）
- page_type判定: 1ページ目=content、2ページ目=index（奥付・記号説明ページ）→ 正しい
- Markdown品質: 青空文庫のルビ記法《》・注記［＃］・章番号（一）・段落構造を保持。目視で忠実と確認
- 認証まわりの発見: 新規Supabaseプロジェクトのaccess tokenはES256+kid署名
  （Legacy HS256 secretは未使用）→ APIはJWKS検証を実装（auth.ts）
- インフラの発見: R2直接PUTにはバケットCORS設定が必須 / wrangler devの
  remote R2 bindingはworkers.devサブドメイン登録が前提
判断: プロンプトv1採用（活字PDFでは十分な品質）。写真撮影ページ・図表の多い専門書での
      検証は未実施 → 次の実書籍検証で確認。コスト計測はM5-03で実施
```

### テンプレート
```
日付: YYYY-MM-DD
対象: (例: PageAnalyzerプロンプト v1→v2)
仮説:
方法: (評価サンプル・指標)
結果:
判断: 採用 / 不採用 / 保留
```
