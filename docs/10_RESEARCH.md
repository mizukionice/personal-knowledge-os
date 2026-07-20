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
対象: M4-05 引用付きチャット検証（Retriever/Reasonerプロンプト v1 / claude-opus-4-8）
仮説: Hybrid検索+graph expansionのコンテキストで、出典付き回答とハルシネーション抑制が両立する
方法: /chat（SSE）に蔵書内2問・蔵書外1問を投げ、出典の正確性と挙動を確認
結果:
- 蔵書内「TCPとUDPの違い」: 通信方式・信頼性の仕組み・用途・ヘッダ構造まで
  情報処理基礎のみから回答。全文にわたり [情報処理基礎 p.8-9 §5.5.x] の出典付き。
  citationのdocument_id解決も全件正しい
- 蔵書内「羅生門の下人は最後にどうなった？」: 結末（着物を奪い夜の底へ・行方は誰も知らない）を
  p.5出典付きで正答
- 蔵書外「フランス革命が起きた原因は？」: 定型句「あなたのライブラリにはこの情報がありません」
  →「以下は蔵書外の一般知識です:」で区別して回答。used_general_knowledge=true、偽citationなし
- graph expansion: 蜘蛛の糸の質問で芥川龍之介概念の1-hop先（羅生門・カルメン）の
  チャンクがコンテキストに追加されることをRPC単体でも確認
判断: プロンプトv1採用。M4完了。今後の改善候補: citationのページ精度評価（大規模蔵書時）、
      会話履歴が長い場合の検索クエリ書き換え（現状は最新メッセージのみで検索）
```

```
日付: 2026-07-20
対象: M2-09 実書籍E2E検証（写真10ページ: 「情報処理基礎」慶応義塾大学理工学部・ネットワーク章）
仮説: スマホ撮影した専門書ページでもVLM解析が実用品質のMarkdown・概念を生成できる
方法: 写真10枚（各約8MB JPEG）をブラウザからアップロードし全工程を実行、DB内容と検索を確認
結果（2つのバグを修正して完走）:
- バグ1: 写真がbase64換算でClaude APIの10MB制限を超過し全10ページ失敗
  → 修正: VLM送信前にmupdfで長辺2000px以下へ縮小・JPEG再エンコード（新規ライブラリなし、
    R2の原本は無変換）。全ページ成功
- バグ2: 知識化ステージが「LLM output was truncated (max_tokens reached)」で失敗。
  adaptive thinkingの思考トークンはmax_tokensの内数で、8192では10ページ分の概念抽出
  JSONが収まらない → 修正: messages.stream()化 + max_tokens=32000
- chunks: 47件。section_pathが「5章 > 5.1〜5.5 > 5.4.1等」と3階層の章構造を正確に反映。
  figure/textのchunk_type分離も機能
- concepts: 97件新規（計117件）。専門用語の抽出品質良好。日英表記ゆれ統合が機能
  （例: CIDR/サイダー/Classless Inter Domain Routing、ISP/インターネット接続業者）
- concept_links: +109件（計126件）
- Hybrid検索: 「衝突を検知したら乱数時間待ってから再送信する方式」→ トップヒットが
  5.3節のCSMA/CD・コリジョンの該当箇所
判断: M2-09完了。写真入力は前処理込みで実用品質。図表の説明品質の詳細評価と
      コスト計測はM5-03で実施
```

```
日付: 2026-07-20
対象: M3-09 概念横断リンク検証（3冊: 蜘蛛の糸2p / カルメン1p / 羅生門6p、いずれも青空文庫・芥川）
仮説: 2冊目以降の処理で同一概念が新規作成されず既存概念へ合流（同定）される
方法: 「羅生門」PDF（青空文庫HTML→Edge headlessでPDF化6ページ）をAPI経由でアップロード・処理。
      「カルメン」はブラウザから別途アップロード。処理後にconcepts/concept_mentions/concept_linksを確認
結果:
- concepts: 計20件、重複なし。「芥川龍之介」「青空文庫」が3ドキュメント全てのmentionを持つ
  ★横断概念として同定された（別IDの重複行は作られていない）
- 羅生門の新規概念: 下人0.9/老婆0.9/羅生門0.9/引剥0.7/検非違使0.4など。importance妥当。
  「感傷主義/Sentimentalisme」の表記ゆれ統合も機能
- concept_links: 計17件。羅生門 -[relates_to]-> 芥川龍之介 が追加され、既存の
  蜘蛛の糸 -[relates_to]-> 芥川龍之介 と同一概念ノードを共有 → グラフが本を横断して接続
- 横断検索: クエリ「楼の上で死人の髪の毛を抜く老婆」のトップヒットが羅生門の該当場面（3冊横断のindexから）
発見（運用上の注意）:
- 羅生門p2-3がClaude APIの「Output blocked by content filtering policy」(400)で失敗。
  死骸描写のページで発生。リトライで通る（p2は2回目、p3は3回目で成功）＝確率的なブロック。
  古典文学でも起こり得るため、ページ失敗リトライは今後も必須機能
- ローカル時計がSupabaseより数秒遅れていると、発行直後のaccess tokenがiat未来判定で
  API側JWT検証に401で弾かれる（数秒待てば解消）
判断: M3-09完了。概念同定（canonical_name一致＋embedding近傍照合）は少冊数では機能。
      冊数増加時の誤同定（同名異概念）の検証はM5以降の実書籍で行う
```

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
