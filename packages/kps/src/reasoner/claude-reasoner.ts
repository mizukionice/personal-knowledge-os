import type { Reasoner, ReasonerAnswer, RetrievedChunk } from '../interfaces';
import type { LlmClient } from '../llm/llm-client';
import { buildReasonerUserText, REASONER_SYSTEM_PROMPT_V1 } from '../prompts/reasoner.v1';
import { parseCitations } from './citations';
import { compressContext } from './context-compressor';

/** KPS §9: 検索結果チャンクは合計8000トークン以内に絞る */
export const REASONER_CONTEXT_BUDGET = 8000;

/**
 * Reasoner実装（KPS §9: Citation First）。
 * プロンプト組立・コンテキスト圧縮・citation解決を担い、LLM呼び出しは注入されたLlmClientに委譲する。
 * ストリーミングが必要なAPI側は buildReasonerUserText / parseCitations / compressContext を直接使う。
 */
export class ClaudeReasoner implements Reasoner {
  constructor(private readonly llm: LlmClient) {}

  async answer(question: string, context: RetrievedChunk[]): Promise<ReasonerAnswer> {
    const compressed = compressContext(context, REASONER_CONTEXT_BUDGET);
    const raw = await this.llm.complete({
      system: REASONER_SYSTEM_PROMPT_V1,
      user: buildReasonerUserText(question, compressed),
    });
    const { citations, usedGeneralKnowledge } = parseCitations(raw, compressed);
    return { answer: raw, citations, usedGeneralKnowledge };
  }
}
