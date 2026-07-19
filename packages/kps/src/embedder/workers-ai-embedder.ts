import type { Embedder } from '../interfaces';

export interface WorkersAiEmbedderOptions {
  accountId: string;
  apiToken: string;
  /** 差し替え可能（ADR: Workers AI @cf/baai/bge-m3） */
  model?: string;
  /** 1リクエストあたりのテキスト数 */
  batchSize?: number;
  /** テスト注入用 */
  fetchFn?: typeof fetch;
}

const DEFAULT_MODEL = '@cf/baai/bge-m3';
const DEFAULT_BATCH_SIZE = 20;
const EXPECTED_DIMENSIONS = 1024;
const MAX_ATTEMPTS = 3;

interface WorkersAiResponse {
  success?: boolean;
  result?: { data?: number[][] };
  errors?: { message?: string }[];
}

/** Workers AI REST APIによるEmbedder実装（BGE-M3, 1024次元） */
export class WorkersAiEmbedder implements Embedder {
  private readonly url: string;
  private readonly apiToken: string;
  private readonly batchSize: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: WorkersAiEmbedderOptions) {
    const model = options.model ?? DEFAULT_MODEL;
    this.url = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model}`;
    this.apiToken = options.apiToken;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize);
      vectors.push(...(await this.embedBatch(batch)));
    }
    return vectors;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    let lastError: Error = new Error('embedding failed');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetchFn(this.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: texts }),
        });

        // レート制限・一時エラーは指数バックオフでリトライ（TDD §5）
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Workers AI returned status ${response.status}`);
        }
        const body = (await response.json()) as WorkersAiResponse;
        if (!response.ok || body.success === false) {
          const message = body.errors?.[0]?.message ?? `status ${response.status}`;
          throw new NonRetryableError(`Workers AI request failed: ${message}`);
        }

        const data = body.result?.data;
        if (!Array.isArray(data) || data.length !== texts.length) {
          throw new NonRetryableError(
            `unexpected Workers AI response: expected ${texts.length} vectors, got ${Array.isArray(data) ? data.length : typeof data}`,
          );
        }
        for (const vector of data) {
          if (!Array.isArray(vector) || vector.length !== EXPECTED_DIMENSIONS) {
            throw new NonRetryableError(
              `unexpected embedding dimensions: ${Array.isArray(vector) ? vector.length : typeof vector} (expected ${EXPECTED_DIMENSIONS})`,
            );
          }
        }
        return data;
      } catch (e) {
        if (e instanceof NonRetryableError) throw e;
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < MAX_ATTEMPTS) {
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError;
  }
}

class NonRetryableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
