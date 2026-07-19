import Anthropic from '@anthropic-ai/sdk';

import type { LlmClient, LlmRequest } from './llm-client';

export interface ClaudeLlmClientOptions {
  /** 省略時はSDKが ANTHROPIC_API_KEY 環境変数から解決する */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 8192;
const MAX_RETRIES = 3;

/** Claude APIによるLlmClient実装 */
export class ClaudeLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ClaudeLlmClientOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: MAX_RETRIES });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(request: LlmRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    });

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
