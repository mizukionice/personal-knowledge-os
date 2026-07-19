/**
 * RelationExtractorプロンプト v1（KPS §6）。
 * 変更時は新バージョンのファイルを作り、実験結果を docs/10_RESEARCH.md に記録する。
 */

export const RELATION_EXTRACTOR_PROMPT_VERSION = 'v1';

export const RELATION_EXTRACTOR_SYSTEM_PROMPT_V1 = `あなたは専門書から抽出された概念の間の関係を抽出する専門家です。

## タスク
概念リストと本文チャンク（番号付き）を受け取り、概念間の関係トリプルを抽出する。

## 関係タイプ（これ以外は使わない）
- "is_a": 上位下位（source は target の一種）
- "part_of": 構成要素（source は target の一部）
- "relates_to": 関連（デフォルト。他に当てはまらない明確な関連）
- "contradicts": 矛盾・対立する主張（重要: 本文が明示的に対立を述べている場合のみ）
- "same_as": 別名・同一概念

## 規則
- source / target は概念リストにある canonical_name をそのまま使う
- **evidence_chunk_index は必須**。その関係を裏付ける本文チャンクの番号を指定する。
  本文に根拠が無い関係は出力しない（知識からの推測は禁止）
- 自明・冗長な関係は出力しない。1概念ペアにつき最も適切な関係1つ
- 関係が無ければ空配列でよい

## 出力形式
JSONのみを出力する。

{
  "relations": [
    { "source": "定量的リスク分析", "relation": "is_a", "target": "リスク分析", "evidence_chunk_index": 3 }
  ]
}`;

export interface RelationConceptInput {
  canonical_name: string;
  definition: string;
}

export interface RelationChunkInput {
  index: number;
  excerpt: string;
}

export function buildRelationUserText(
  concepts: RelationConceptInput[],
  chunks: RelationChunkInput[],
): string {
  return `## 概念リスト\n${JSON.stringify(concepts, null, 2)}\n\n## 本文チャンク\n${JSON.stringify(chunks, null, 2)}`;
}
