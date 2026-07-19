import { z } from 'zod';

import {
  RELATION_TYPES,
  type ChunkDraft,
  type ConceptDraft,
  type RelationDraft,
  type RelationExtractor,
  type RelationType,
} from '../interfaces';
import { completeJson } from '../llm/json';
import type { LlmClient } from '../llm/llm-client';
import {
  buildRelationUserText,
  RELATION_EXTRACTOR_SYSTEM_PROMPT_V1,
} from '../prompts/relation-extractor.v1';

/** チャンク本文はトークン量を抑えるため先頭のみをLLMに渡す */
const EXCERPT_CHARS = 500;

// LLMの1行の逸脱でバッチ全体を落とさないよう、行単位はゆるく受けて後段でフィルタする
const relationRowSchema = z.object({
  source: z.string(),
  relation: z.string(),
  target: z.string(),
  evidence_chunk_index: z.number().int().nullish(),
});

const relationResultSchema = z.object({
  relations: z.array(relationRowSchema).default([]),
});

/**
 * RelationExtractor実装（KPS §6）。
 * 書籍の概念リスト+定義とチャンク抜粋をLLMに渡し、関係トリプルを抽出する。
 * evidence（根拠チャンク）の無い関係・不正な行は破棄する。
 */
export class LlmRelationExtractor implements RelationExtractor {
  constructor(private readonly llm: LlmClient) {}

  async extract(concepts: ConceptDraft[], chunks: ChunkDraft[]): Promise<RelationDraft[]> {
    if (concepts.length < 2 || chunks.length === 0) return [];

    const { relations } = await completeJson(
      this.llm,
      relationResultSchema,
      RELATION_EXTRACTOR_SYSTEM_PROMPT_V1,
      buildRelationUserText(
        concepts.map((concept) => ({
          canonical_name: concept.canonicalName,
          definition: concept.definition,
        })),
        chunks.map((chunk, index) => ({
          index,
          excerpt: chunk.content.slice(0, EXCERPT_CHARS),
        })),
      ),
    );

    const knownNames = new Set(concepts.map((concept) => concept.canonicalName));
    const drafts: RelationDraft[] = [];
    const seen = new Set<string>();

    for (const row of relations) {
      // evidence必須（KPS §6）。範囲外・欠落は破棄
      if (
        row.evidence_chunk_index == null ||
        row.evidence_chunk_index < 0 ||
        row.evidence_chunk_index >= chunks.length
      ) {
        continue;
      }
      if (!(RELATION_TYPES as readonly string[]).includes(row.relation)) continue;
      if (!knownNames.has(row.source) || !knownNames.has(row.target)) continue;
      if (row.source === row.target) continue;

      const key = `${row.source}|${row.relation}|${row.target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      drafts.push({
        sourceConceptName: row.source,
        relation: row.relation as RelationType,
        targetConceptName: row.target,
        evidenceChunkIndex: row.evidence_chunk_index,
      });
    }
    return drafts;
  }
}
