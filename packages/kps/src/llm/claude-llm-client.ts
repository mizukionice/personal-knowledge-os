import Anthropic from '@anthropic-ai/sdk';

import { toTokenUsage, type TokenUsage } from '../usage/usage-meter';
import type { LlmClient, LlmRequest } from './llm-client';

export interface ClaudeLlmClientOptions {
  /** 省略時はSDKが ANTHROPIC_API_KEY 環境変数から解決する */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** コスト計測用（M5-03）。API呼び出しごとにトークン使用量を通知する */
  onUsage?: (usage: TokenUsage) => void;
}

const DEFAULT_MODEL = 'claude-opus-4-8';
// adaptive thinkingの思考トークンはmax_tokensの内数。8192では長文書の
// 概念抽出JSONが切り詰められた（M2-09検証）ため32000に引き上げ。
// 16Kを超えるmax_tokensはHTTPタイムアウト回避のためストリーミング必須
const DEFAULT_MAX_TOKENS = 32000;
const MAX_RETRIES = 3;

/** Claude APIによるLlmClient実装 */
export class ClaudeLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly onUsage?: (usage: TokenUsage) => void;

  constructor(options: ClaudeLlmClientOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: MAX_RETRIES });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.onUsage = options.onUsage;
  }

  async complete(request: LlmRequest): Promise<string> {
    const response = await this.client.messages
      .stream({
        model: this.model,
        max_tokens: this.maxTokens,
        thinking: { type: 'adaptive' },
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      })
      .finalMessage();

    this.onUsage?.(toTokenUsage(response.usage));

    if (response.stop_reason === 'refusal') {
      throw new Error('LLM refused the request');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('LLM output was truncated (max_tokens reached)');
    }
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
