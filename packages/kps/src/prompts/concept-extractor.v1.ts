/**
 * ConceptExtractorプロンプト v1（KPS §5）。
 * 変更時は新バージョンのファイルを作り、実験結果を docs/10_RESEARCH.md に記録する。
 */

export const CONCEPT_EXTRACTOR_PROMPT_VERSION = 'v1';

export const CONCEPT_NORMALIZER_SYSTEM_PROMPT_V1 = `あなたは専門書から抽出された概念（専門用語・固有名詞・手法名）のリストを正規化する専門家です。

## タスク
ページ単位で抽出された概念の生リストを受け取り、表記ゆれを統合して正規化された概念リストを作る。

## 正規化の規則
- 同一概念の表記ゆれ（英名/和名/略称/大文字小文字）は1つに統合する
  例: "EVM" / "アーンドバリューマネジメント" / "Earned Value Management" → 1概念
- canonical_name はその分野で最も標準的な名称（原語優先。日本語書籍で和名が標準なら和名）
- aliases には統合した別表記をすべて入れる（canonical_name自体は含めない）
- definition は各ページの定義を統合した1〜3文の要約
- importance は統合元の最大値
- merged_from には統合した生リスト上の名前を**入力の表記のまま**すべて入れる
- 別概念を無理に統合しない（例: 「リスク」と「リスク管理」は別概念）

## 出力形式
JSONのみを出力する。説明文・コードフェンスは付けない。

{
  "concepts": [
    {
      "canonical_name": "Earned Value Management",
      "aliases": ["EVM", "アーンドバリューマネジメント"],
      "merged_from": ["EVM", "アーンドバリューマネジメント"],
      "definition": "統合された定義の要約",
      "importance": 0.8
    }
  ]
}`;

export interface RawConceptInput {
  name: string;
  name_ja?: string | null;
  definition: string;
  importance: number;
  pages: number[];
}

export function buildNormalizeUserText(rawConcepts: RawConceptInput[]): string {
  return `以下の生の概念リストを正規化してください。\n\n${JSON.stringify(rawConcepts, null, 2)}`;
}

export const CONCEPT_IDENTITY_SYSTEM_PROMPT_V1 = `あなたは2つの概念が同一のものを指すかを判定する専門家です。

## 判定基準
- 表記が違っても同じ対象・手法・理論を指すなら同一（Yes）
- 上位概念と下位概念は別（No）。例: 「リスク分析」と「定量的リスク分析」
- 関連が深くても対象が異なれば別（No）

## 出力形式
JSONのみを出力する。入力のペアと同じ順序で判定を返す。

{ "results": [true, false] }`;

export interface IdentityPair {
  a: { name: string; definition: string };
  b: { name: string; definition: string };
}

export function buildIdentityUserText(pairs: IdentityPair[]): string {
  return `以下の概念ペアそれぞれについて、同一概念かを判定してください。\n\n${JSON.stringify(pairs, null, 2)}`;
}
