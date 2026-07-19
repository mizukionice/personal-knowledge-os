import { describe, expect, it, vi } from 'vitest';

import type { ChunkDraft, ConceptDraft } from '../interfaces';
import type { LlmRequest } from '../llm/llm-client';
import { LlmRelationExtractor } from './llm-relation-extractor';

function concept(canonicalName: string, definition = ''): ConceptDraft {
  return {
    canonicalName,
    aliases: [],
    definition,
    importance: 0.5,
    pageNumbers: [1],
    existingConceptId: null,
  };
}

function chunk(content: string): ChunkDraft {
  return { chunkType: 'text', content, sectionPath: null, pageStart: 1, pageEnd: 1 };
}

function mockLlm(...responses: string[]) {
  const complete = vi.fn<(req: LlmRequest) => Promise<string>>();
  for (const response of responses) {
    complete.mockResolvedValueOnce(response);
  }
  return { complete };
}

const concepts = [concept('リスク分析'), concept('定量的リスク分析'), concept('モンテカルロ法')];
const chunks = [chunk('チャンク0の本文'), chunk('チャンク1の本文')];

describe('LlmRelationExtractor', () => {
  it('evidence付きの有効なトリプルをRelationDraftにする', async () => {
    const llm = mockLlm(
      JSON.stringify({
        relations: [
          {
            source: '定量的リスク分析',
            relation: 'is_a',
            target: 'リスク分析',
            evidence_chunk_index: 1,
          },
          {
            source: 'モンテカルロ法',
            relation: 'relates_to',
            target: '定量的リスク分析',
            evidence_chunk_index: 0,
          },
        ],
      }),
    );
    const extractor = new LlmRelationExtractor(llm);

    const drafts = await extractor.extract(concepts, chunks);

    expect(drafts).toEqual([
      {
        sourceConceptName: '定量的リスク分析',
        relation: 'is_a',
        targetConceptName: 'リスク分析',
        evidenceChunkIndex: 1,
      },
      {
        sourceConceptName: 'モンテカルロ法',
        relation: 'relates_to',
        targetConceptName: '定量的リスク分析',
        evidenceChunkIndex: 0,
      },
    ]);

    // 概念とチャンク抜粋がプロンプトに含まれる
    const user = llm.complete.mock.calls[0]![0].user;
    expect(user).toContain('定量的リスク分析');
    expect(user).toContain('チャンク0の本文');
  });

  it('evidenceが欠落・範囲外のトリプルは破棄する（evidence必須）', async () => {
    const llm = mockLlm(
      JSON.stringify({
        relations: [
          { source: '定量的リスク分析', relation: 'is_a', target: 'リスク分析' },
          {
            source: 'モンテカルロ法',
            relation: 'relates_to',
            target: 'リスク分析',
            evidence_chunk_index: 99,
          },
          {
            source: '定量的リスク分析',
            relation: 'relates_to',
            target: 'モンテカルロ法',
            evidence_chunk_index: -1,
          },
        ],
      }),
    );
    const drafts = await new LlmRelationExtractor(llm).extract(concepts, chunks);
    expect(drafts).toEqual([]);
  });

  it('未知の関係タイプ・未知の概念・自己関係・重複は破棄する', async () => {
    const llm = mockLlm(
      JSON.stringify({
        relations: [
          {
            source: 'リスク分析',
            relation: 'causes',
            target: 'モンテカルロ法',
            evidence_chunk_index: 0,
          },
          {
            source: '未知の概念',
            relation: 'relates_to',
            target: 'リスク分析',
            evidence_chunk_index: 0,
          },
          {
            source: 'リスク分析',
            relation: 'relates_to',
            target: 'リスク分析',
            evidence_chunk_index: 0,
          },
          {
            source: 'リスク分析',
            relation: 'relates_to',
            target: 'モンテカルロ法',
            evidence_chunk_index: 0,
          },
          {
            source: 'リスク分析',
            relation: 'relates_to',
            target: 'モンテカルロ法',
            evidence_chunk_index: 1,
          },
        ],
      }),
    );
    const drafts = await new LlmRelationExtractor(llm).extract(concepts, chunks);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.relation).toBe('relates_to');
    expect(drafts[0]?.evidenceChunkIndex).toBe(0);
  });

  it('概念が1つ以下またはチャンクが無ければLLMを呼ばない', async () => {
    const llm = mockLlm();
    const extractor = new LlmRelationExtractor(llm);
    expect(await extractor.extract([concept('単独')], chunks)).toEqual([]);
    expect(await extractor.extract(concepts, [])).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('長いチャンクは抜粋（500字）に切り詰めてLLMに渡す', async () => {
    const llm = mockLlm(JSON.stringify({ relations: [] }));
    const longChunk = chunk('あ'.repeat(2000));
    await new LlmRelationExtractor(llm).extract(concepts, [longChunk]);

    const user = llm.complete.mock.calls[0]![0].user;
    const parsedChunks = /## 本文チャンク\n(\[[\s\S]*\])/.exec(user);
    const excerpts = JSON.parse(parsedChunks![1]!) as { excerpt: string }[];
    expect(excerpts[0]!.excerpt.length).toBe(500);
  });
});
