import Anthropic from '@anthropic-ai/sdk';

import type { VlmClient, VlmRequest } from './vlm-client';

export interface ClaudeVlmClientOptions {
  /** 省略時はSDKが ANTHROPIC_API_KEY 環境変数から解決する */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 8192;
// TDD §5: VLM API呼び出しは指数バックオフで3回リトライ（SDK組み込みのretryを使用）
const MAX_RETRIES = 3;

/** Claude APIによるVlmClient実装 */
export class ClaudeVlmClient implements VlmClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ClaudeVlmClientOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: MAX_RETRIES });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(request: VlmRequest): Promise<string> {
    const [first, ...rest] = request.turns;
    if (!first || first.role !== 'user') {
      throw new Error('VlmRequest.turns must start with a user turn');
    }

    // 画像は最初のuserターンにのみ添付する
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: request.image.mediaType,
              data: Buffer.from(request.image.data).toString('base64'),
            },
          },
          { type: 'text', text: first.text },
        ],
      },
      ...rest.map((turn) => ({ role: turn.role, content: turn.text })),
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      system: request.system,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('VLM refused to analyze the page');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('VLM output was truncated (max_tokens reached)');
    }

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
