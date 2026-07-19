import { describe, expect, it, vi } from 'vitest';
import type { PageAnalysis } from '@pkos/shared';
import type { AnalyzedPage, ChunkDraft, ConceptDraft, Embedder } from '@pkos/kps';

import { runKnowledgeStage, type KnowledgeDeps } from './knowledge-stage';
import type { Db, DocumentRow } from './types';

const USER = 'user-1';
const DOC = 'doc-1';

const document: DocumentRow = {
  id: DOC,
  user_id: USER,
  title: 'テスト書籍',
  doc_type: 'book',
  status: 'processing',
  page_count: 2,
  r2_prefix: `${USER}/${DOC}/`,
};

function analyzedPage(pageNumber: number): AnalyzedPage {
  return {
    pageNumber,
    analysis: {
      markdown: `# p${pageNumber}`,
      page_type: 'content',
      sections: [],
      figures: [],
      tables: [],
      formulas: [],
      concepts: [],
      context_summary: '',
    } as PageAnalysis,
  };
}

function chunkDraft(pageNumber: number, content: string): ChunkDraft {
  return {
    chunkType: 'text',
    content,
    sectionPath: '第1章',
    pageStart: pageNumber,
    pageEnd: pageNumber,
  };
}

function conceptDraft(overrides: Partial<ConceptDraft>): ConceptDraft {
  return {
    canonicalName: 'EVM',
    aliases: [],
    definition: '進捗管理手法',
    importance: 0.8,
    pageNumbers: [1],
    existingConceptId: null,
    ...overrides,
  };
}

function fakeKnowledgeDb() {
  const state = {
    chunks: [] as Record<string, unknown>[],
    concepts: new Map<string, { importance: number }>(),
    mentions: [] as Record<string, unknown>[],
    links: [] as Record<string, unknown>[],
    deleted: false,
  };
  let chunkSeq = 0;
  let conceptSeq = 0;

  const db = {
    deleteDocumentKnowledge: vi.fn(async () => {
      state.deleted = true;
    }),
    insertChunks: vi.fn(async (rows: Record<string, unknown>[]) => {
      state.chunks.push(...rows);
      return rows.map(() => `chunk-${chunkSeq++}`);
    }),
    findConceptByName: vi.fn(async () => null),
    findSimilarConcepts: vi.fn(async () => []),
    upsertConcept: vi.fn(async () => {
      const id = `concept-${conceptSeq++}`;
      state.concepts.set(id, { importance: 0 });
      return id;
    }),
    getConceptImportance: vi.fn(async () => 0.5),
    updateConcept: vi.fn(async () => {}),
    insertMentions: vi.fn(async (rows: Record<string, unknown>[]) => {
      state.mentions.push(...rows);
    }),
    insertLinks: vi.fn(async (rows: Record<string, unknown>[]) => {
      state.links.push(...rows);
    }),
  };
  return { db: db as unknown as Db, raw: db, state };
}

function makeDeps(overrides: Partial<Omit<KnowledgeDeps, 'db'>> = {}) {
  const embedder: Embedder = {
    embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
  };
  return {
    chunker: { chunk: vi.fn(() => [chunkDraft(1, '本文1'), chunkDraft(2, '本文2')]) },
    embedder,
    conceptExtractor: { extract: vi.fn(async () => [conceptDraft({})]) },
    relationExtractor: { extract: vi.fn(async () => []) },
    ...overrides,
  };
}

describe('runKnowledgeStage', () => {
  it('chunks/embedding/concepts/mentionsを保存する', async () => {
    const { db, raw, state } = fakeKnowledgeDb();
    const deps = makeDeps();

    await runKnowledgeStage(
      { db, ...deps },
      document,
      [analyzedPage(1), analyzedPage(2)],
      () => {},
    );

    // 既存knowledgeの削除 → chunks保存（embedding付き）
    expect(state.deleted).toBe(true);
    expect(state.chunks).toHaveLength(2);
    expect(state.chunks[0]).toMatchObject({
      user_id: USER,
      document_id: DOC,
      chunk_type: 'text',
      section_path: '第1章',
      embedding: JSON.stringify([0.1, 0.2]),
    });

    // 新規conceptはembedding付きでupsert
    expect(raw.upsertConcept).toHaveBeenCalledWith(
      expect.objectContaining({ canonical_name: 'EVM', user_id: USER }),
    );

    // mention: 出現ページ(1)を含むtextチャンク(chunk-0)に紐付く
    expect(state.mentions).toEqual([
      expect.objectContaining({
        concept_id: 'concept-0',
        chunk_id: 'chunk-0',
        document_id: DOC,
        definition: '進捗管理手法',
      }),
    ]);
  });

  it('既存概念（existingConceptId）は新規作成せずimportanceを再計算する', async () => {
    const { db, raw } = fakeKnowledgeDb();
    const deps = makeDeps({
      conceptExtractor: {
        extract: vi.fn(async () => [
          conceptDraft({ existingConceptId: 'existing-1', importance: 0.9 }),
        ]),
      },
    });

    await runKnowledgeStage({ db, ...deps }, document, [analyzedPage(1)], () => {});

    expect(raw.upsertConcept).not.toHaveBeenCalled();
    // 既存0.5 < 新0.9 → 更新
    expect(raw.updateConcept).toHaveBeenCalledWith('existing-1', { importance: 0.9 });
  });

  it('関係はconcept id / evidence chunk idに解決して保存する', async () => {
    const { db, state } = fakeKnowledgeDb();
    const deps = makeDeps({
      conceptExtractor: {
        extract: vi.fn(async () => [
          conceptDraft({ canonicalName: 'A', pageNumbers: [1] }),
          conceptDraft({ canonicalName: 'B', pageNumbers: [2] }),
        ]),
      },
      relationExtractor: {
        extract: vi.fn(async () => [
          {
            sourceConceptName: 'A',
            relation: 'contradicts' as const,
            targetConceptName: 'B',
            evidenceChunkIndex: 1,
          },
        ]),
      },
    });

    await runKnowledgeStage({ db, ...deps }, document, [analyzedPage(1)], () => {});

    expect(state.links).toEqual([
      {
        user_id: USER,
        source_concept_id: 'concept-0',
        target_concept_id: 'concept-1',
        relation: 'contradicts',
        evidence_chunk_id: 'chunk-1',
      },
    ]);
  });

  it('chunksが空なら何も保存しない', async () => {
    const { db, raw } = fakeKnowledgeDb();
    const deps = makeDeps({ chunker: { chunk: vi.fn(() => []) } });

    await runKnowledgeStage({ db, ...deps }, document, [analyzedPage(1)], () => {});

    expect(raw.deleteDocumentKnowledge).not.toHaveBeenCalled();
    expect(raw.insertChunks).not.toHaveBeenCalled();
  });

  it('ConceptLookupがdbに委譲される', async () => {
    const { db, raw } = fakeKnowledgeDb();
    let capturedLookup: unknown;
    const deps = makeDeps({
      conceptExtractor: {
        extract: vi.fn(async (_pages, lookup) => {
          capturedLookup = lookup;
          await lookup.findByName('EVM');
          await lookup.findSimilar([0.1], 0.9);
          return [];
        }),
      },
    });

    await runKnowledgeStage({ db, ...deps }, document, [analyzedPage(1)], () => {});

    expect(capturedLookup).toBeDefined();
    expect(raw.findConceptByName).toHaveBeenCalledWith(USER, 'EVM');
    expect(raw.findSimilarConcepts).toHaveBeenCalledWith(USER, [0.1], 0.9);
  });
});
