import { z } from 'zod';

import type {
  AnalyzedPage,
  ConceptDraft,
  ConceptExtractor,
  ConceptLookup,
  Embedder,
} from '../interfaces';
import type { LlmClient } from '../llm/llm-client';
import { completeJson } from '../llm/json';
import {
  buildIdentityUserText,
  buildNormalizeUserText,
  CONCEPT_IDENTITY_SYSTEM_PROMPT_V1,
  CONCEPT_NORMALIZER_SYSTEM_PROMPT_V1,
  type IdentityPair,
  type RawConceptInput,
} from '../prompts/concept-extractor.v1';

/** KPS §5: embedding類似度がこの値を超え、かつLLMが同一と判定した場合のみ既存概念に同定する */
const SIMILARITY_THRESHOLD = 0.9;

const normalizationSchema = z.object({
  concepts: z
    .array(
      z.object({
        canonical_name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        merged_from: z.array(z.string()).min(1),
        definition: z.string().default(''),
        importance: z.number().min(0).max(1).default(0.5),
      }),
    )
    .default([]),
});

const identitySchema = z.object({
  results: z.array(z.boolean()),
});

/**
 * ConceptExtractor実装（KPS §5）:
 * 1. PageAnalysisのconcepts[]を書籍単位で集約
 * 2. LLMで表記ゆれを正規化（canonical name + aliases）
 * 3. 既存conceptsとの照合: ①名前完全一致 → ②embedding類似度>0.90 + LLM同一性確認
 */
export class LlmConceptExtractor implements ConceptExtractor {
  constructor(
    private readonly llm: LlmClient,
    private readonly embedder: Embedder,
  ) {}

  async extract(pages: AnalyzedPage[], lookup: ConceptLookup): Promise<ConceptDraft[]> {
    const raw = aggregateRawConcepts(pages);
    if (raw.length === 0) return [];

    const { concepts: normalized } = await completeJson(
      this.llm,
      normalizationSchema,
      CONCEPT_NORMALIZER_SYSTEM_PROMPT_V1,
      buildNormalizeUserText(raw),
    );
    if (normalized.length === 0) return [];

    // 生の名前→出現ページの索引（正規化結果のmerged_fromからページを復元する）
    const pagesByRawName = new Map<string, number[]>();
    for (const item of raw) {
      pagesByRawName.set(normalizeKey(item.name), item.pages);
      if (item.name_ja) pagesByRawName.set(normalizeKey(item.name_ja), item.pages);
    }

    const drafts: ConceptDraft[] = normalized.map((concept) => {
      const pageNumbers = new Set<number>();
      for (const name of concept.merged_from) {
        for (const pageNumber of pagesByRawName.get(normalizeKey(name)) ?? []) {
          pageNumbers.add(pageNumber);
        }
      }
      return {
        canonicalName: concept.canonical_name,
        aliases: concept.aliases.filter((alias) => alias !== concept.canonical_name),
        definition: concept.definition,
        importance: concept.importance,
        pageNumbers: [...pageNumbers].sort((a, b) => a - b),
        existingConceptId: null,
      };
    });

    await this.matchExisting(drafts, lookup);
    return drafts;
  }

  private async matchExisting(drafts: ConceptDraft[], lookup: ConceptLookup): Promise<void> {
    // ① canonical name / aliasの完全一致
    const unmatched: ConceptDraft[] = [];
    for (const draft of drafts) {
      let found: { id: string } | null = null;
      for (const name of [draft.canonicalName, ...draft.aliases]) {
        found = await lookup.findByName(name);
        if (found) break;
      }
      if (found) {
        draft.existingConceptId = found.id;
      } else {
        unmatched.push(draft);
      }
    }
    if (unmatched.length === 0) return;

    // ② embedding類似度 + LLM同一性確認
    const embeddings = await this.embedder.embed(
      unmatched.map((draft) => `${draft.canonicalName}\n${draft.definition}`),
    );
    const pairs: IdentityPair[] = [];
    const pairTargets: { draft: ConceptDraft; candidateId: string }[] = [];

    for (let i = 0; i < unmatched.length; i++) {
      const draft = unmatched[i]!;
      const embedding = embeddings[i]!;
      const candidates = await lookup.findSimilar(embedding, SIMILARITY_THRESHOLD);
      const best = candidates[0];
      if (best) {
        pairs.push({
          a: { name: draft.canonicalName, definition: draft.definition },
          b: { name: best.canonicalName, definition: best.definition },
        });
        pairTargets.push({ draft, candidateId: best.id });
      }
    }
    if (pairs.length === 0) return;

    const { results } = await completeJson(
      this.llm,
      identitySchema,
      CONCEPT_IDENTITY_SYSTEM_PROMPT_V1,
      buildIdentityUserText(pairs),
    );
    for (let i = 0; i < pairTargets.length; i++) {
      if (results[i] === true) {
        pairTargets[i]!.draft.existingConceptId = pairTargets[i]!.candidateId;
      }
    }
  }
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/** ページ単位のconcepts[]を名前キーで集約する */
function aggregateRawConcepts(pages: AnalyzedPage[]): RawConceptInput[] {
  const byKey = new Map<string, RawConceptInput>();

  for (const page of pages) {
    for (const concept of page.analysis.concepts) {
      const key = normalizeKey(concept.name);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.pages.includes(page.pageNumber)) {
          existing.pages.push(page.pageNumber);
        }
        existing.importance = Math.max(existing.importance, concept.importance);
        if (concept.definition && !existing.definition.includes(concept.definition)) {
          existing.definition = existing.definition
            ? `${existing.definition} / ${concept.definition}`
            : concept.definition;
        }
        if (concept.name_ja && !existing.name_ja) {
          existing.name_ja = concept.name_ja;
        }
      } else {
        byKey.set(key, {
          name: concept.name,
          name_ja: concept.name_ja ?? null,
          definition: concept.definition,
          importance: concept.importance,
          pages: [page.pageNumber],
        });
      }
    }
  }
  return [...byKey.values()];
}
