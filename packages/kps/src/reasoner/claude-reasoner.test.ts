import { describe, expect, it, vi } from 'vitest';

import type { RetrievedChunk } from '../interfaces';
import { REASONER_SYSTEM_PROMPT_V1 } from '../prompts/reasoner.v1';
import { ClaudeReasoner } from './claude-reasoner';
import { NO_SOURCE_PHRASE } from './citations';

const context: RetrievedChunk[] = [
  {
    chunkId: 'c1',
    content: '犍陀多は蜘蛛の糸を登った。',
    documentId: 'doc-kumo',
    documentTitle: '蜘蛛の糸',
    pageStart: 1,
    sectionPath: '蜘蛛の糸 > 二',
    score: 1,
  },
];

describe('ClaudeReasoner', () => {
  it('LLM回答からcitationsを解決して返す', async () => {
    const llm = {
      complete: vi.fn().mockResolvedValue('犍陀多は糸を登った[蜘蛛の糸 p.1 §蜘蛛の糸 > 二]。'),
    };
    const reasoner = new ClaudeReasoner(llm);

    const result = await reasoner.answer('犍陀多は何をした？', context);

    expect(result.citations).toEqual([
      {
        documentId: 'doc-kumo',
        documentTitle: '蜘蛛の糸',
        page: 1,
        sectionPath: '蜘蛛の糸 > 二',
      },
    ]);
    expect(result.usedGeneralKnowledge).toBe(false);

    const request = llm.complete.mock.calls[0]![0];
    expect(request.system).toBe(REASONER_SYSTEM_PROMPT_V1);
    expect(request.user).toContain('犍陀多は蜘蛛の糸を登った。');
    expect(request.user).toContain('犍陀多は何をした？');
  });

  it('根拠が無い回答はusedGeneralKnowledge=trueになる', async () => {
    const llm = { complete: vi.fn().mockResolvedValue(`${NO_SOURCE_PHRASE}。`) };
    const reasoner = new ClaudeReasoner(llm);

    const result = await reasoner.answer('フランス革命は？', context);

    expect(result.usedGeneralKnowledge).toBe(true);
    expect(result.citations).toEqual([]);
  });

  it('コンテキストは8000トークン予算で圧縮してからプロンプトに入れる', async () => {
    const big = Array.from({ length: 20 }, (_, i) => ({
      ...context[0]!,
      chunkId: `c${i}`,
      content: 'あ'.repeat(1000),
    }));
    const llm = { complete: vi.fn().mockResolvedValue('回答') };
    const reasoner = new ClaudeReasoner(llm);

    await reasoner.answer('q', big);

    const request = llm.complete.mock.calls[0]![0];
    // 1000トークン/チャンク × 8000予算 → 最大8チャンク
    const included = (request.user.match(/『蜘蛛の糸』/g) ?? []).length;
    expect(included).toBeLessThanOrEqual(8);
    expect(included).toBeGreaterThan(0);
  });
});
