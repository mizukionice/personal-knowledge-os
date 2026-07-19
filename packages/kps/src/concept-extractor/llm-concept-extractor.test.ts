import { describe, expect, it, vi } from 'vitest';
import type { PageConcept } from '@pkos/shared';

import type { AnalyzedPage, ConceptLookup, Embedder } from '../interfaces';
import type { LlmRequest } from '../llm/llm-client';
import { LlmConceptExtractor } from './llm-concept-extractor';

function page(pageNumber: number, concepts: Partial<PageConcept>[]): AnalyzedPage {
  return {
    pageNumber,
    analysis: {
      markdown: '',
      page_type: 'content',
      sections: [],
      figures: [],
      tables: [],
      formulas: [],
      concepts: concepts.map((c) => ({
        name: 'X',
        name_ja: null,
        definition: '',
        importance: 0.5,
        ...c,
      })),
      context_summary: '',
    },
  };
}

const normalizedEvm = {
  concepts: [
    {
      canonical_name: 'Earned Value Management',
      aliases: ['EVM', 'アーンドバリューマネジメント'],
      merged_from: ['EVM', 'アーンドバリューマネジメント'],
      definition: '出来高で進捗を管理する手法',
      importance: 0.8,
    },
  ],
};

function mockLlm(...responses: string[]) {
  const complete = vi.fn<(req: LlmRequest) => Promise<string>>();
  for (const response of responses) {
    complete.mockResolvedValueOnce(response);
  }
  return { complete };
}

function mockEmbedder(): Embedder {
  return { embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])) };
}

function mockLookup(overrides: Partial<ConceptLookup> = {}): ConceptLookup {
  return {
    findByName: vi.fn(async () => null),
    findSimilar: vi.fn(async () => []),
    ...overrides,
  };
}

describe('LlmConceptExtractor', () => {
  it('ページ横断で集約し、LLM正規化の結果をConceptDraftにする', async () => {
    const llm = mockLlm(JSON.stringify(normalizedEvm));
    const extractor = new LlmConceptExtractor(llm, mockEmbedder());

    const drafts = await extractor.extract(
      [
        page(1, [{ name: 'EVM', definition: '進捗管理手法', importance: 0.7 }]),
        page(3, [{ name: 'アーンドバリューマネジメント', importance: 0.8 }]),
        page(5, [{ name: 'EVM' }]),
      ],
      mockLookup(),
    );

    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.canonicalName).toBe('Earned Value Management');
    expect(draft.aliases).toEqual(['EVM', 'アーンドバリューマネジメント']);
    // merged_fromから出現ページを復元（EVM: p1,p5 / 和名: p3）
    expect(draft.pageNumbers).toEqual([1, 3, 5]);
    expect(draft.existingConceptId).toBeNull();

    // 集約済みリストがLLMに渡る
    const userText = llm.complete.mock.calls[0]![0].user;
    expect(userText).toContain('EVM');
    expect(userText).toContain('アーンドバリューマネジメント');
  });

  it('概念が無ければLLMを呼ばず[]を返す', async () => {
    const llm = mockLlm();
    const extractor = new LlmConceptExtractor(llm, mockEmbedder());
    expect(await extractor.extract([page(1, [])], mockLookup())).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('名前完全一致で既存概念に同定する（aliasも照合）', async () => {
    const llm = mockLlm(JSON.stringify(normalizedEvm));
    const findByName = vi.fn(async (name: string) =>
      name === 'EVM' ? { id: 'concept-1', canonicalName: 'Earned Value Management' } : null,
    );
    const extractor = new LlmConceptExtractor(llm, mockEmbedder());

    const drafts = await extractor.extract(
      [page(1, [{ name: 'EVM' }])],
      mockLookup({ findByName }),
    );

    expect(drafts[0]?.existingConceptId).toBe('concept-1');
    // 完全一致したのでembedding照合・同一性確認は走らない
    expect(llm.complete).toHaveBeenCalledOnce();
  });

  it('類似候補（>0.90）はLLMがYesなら同定、Noなら新規のまま', async () => {
    const llm = mockLlm(
      JSON.stringify({
        concepts: [
          {
            canonical_name: 'リスク対応',
            aliases: [],
            merged_from: ['リスク対応'],
            definition: 'リスクへの対応戦略',
            importance: 0.6,
          },
          {
            canonical_name: 'モンテカルロ法',
            aliases: [],
            merged_from: ['モンテカルロ法'],
            definition: '乱数によるシミュレーション',
            importance: 0.7,
          },
        ],
      }),
      JSON.stringify({ results: [true, false] }),
    );
    const findSimilar = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'c-risk', canonicalName: 'リスク対応戦略', definition: '戦略', similarity: 0.94 },
      ])
      .mockResolvedValueOnce([
        { id: 'c-sim', canonicalName: 'シミュレーション', definition: '模擬', similarity: 0.91 },
      ]);
    const extractor = new LlmConceptExtractor(llm, mockEmbedder());

    const drafts = await extractor.extract(
      [page(1, [{ name: 'リスク対応' }, { name: 'モンテカルロ法' }])],
      mockLookup({ findSimilar }),
    );

    expect(drafts[0]?.existingConceptId).toBe('c-risk');
    expect(drafts[1]?.existingConceptId).toBeNull();
    // 正規化 + 同一性確認の2回
    expect(llm.complete).toHaveBeenCalledTimes(2);
    const identityUser = llm.complete.mock.calls[1]![0].user;
    expect(identityUser).toContain('リスク対応戦略');
  });

  it('類似候補が閾値未満なら同一性確認は走らない', async () => {
    const llm = mockLlm(JSON.stringify(normalizedEvm));
    const findSimilar = vi.fn(async () => []);
    const extractor = new LlmConceptExtractor(llm, mockEmbedder());

    const drafts = await extractor.extract(
      [page(1, [{ name: 'EVM' }])],
      mockLookup({ findSimilar }),
    );

    expect(drafts[0]?.existingConceptId).toBeNull();
    expect(llm.complete).toHaveBeenCalledOnce();
    expect(findSimilar).toHaveBeenCalledWith(expect.any(Array), 0.9);
  });

  it('不正なLLM出力は修復リトライされる', async () => {
    const llm = mockLlm('not json', JSON.stringify(normalizedEvm));
    const extractor = new LlmConceptExtractor(llm, mockEmbedder());

    const drafts = await extractor.extract([page(1, [{ name: 'EVM' }])], mockLookup());

    expect(drafts).toHaveLength(1);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
});
