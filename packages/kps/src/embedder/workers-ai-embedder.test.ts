import { describe, expect, it, vi } from 'vitest';

import { WorkersAiEmbedder } from './workers-ai-embedder';

const DIM = 1024;
const vec = (seed: number) => Array.from({ length: DIM }, (_, i) => (seed + i) / DIM);

function okResponse(vectors: number[][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, result: { data: vectors } }),
  } as Response;
}

function makeEmbedder(fetchFn: typeof fetch, batchSize = 20) {
  return new WorkersAiEmbedder({
    accountId: 'acct',
    apiToken: 'token',
    batchSize,
    fetchFn,
  });
}

describe('WorkersAiEmbedder', () => {
  it('テキストをBGE-M3のエンドポイントに送り1024次元ベクトルを返す', async () => {
    const fetchFn = vi.fn(async () => okResponse([vec(1), vec(2)]));
    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch);

    const result = await embedder.embed(['本文A', '本文B']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(DIM);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/baai/bge-m3');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual({ text: ['本文A', '本文B'] });
  });

  it('batchSizeを超える入力は分割して送る', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const { text } = JSON.parse(init.body as string) as { text: string[] };
      return okResponse(text.map((_, i) => vec(i)));
    });
    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch, 2);

    const result = await embedder.embed(['a', 'b', 'c', 'd', 'e']);

    expect(result).toHaveLength(5);
    expect(fetchFn).toHaveBeenCalledTimes(3); // 2+2+1
  });

  it('空入力はAPIを呼ばず[]を返す', async () => {
    const fetchFn = vi.fn();
    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch);
    expect(await embedder.embed([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('5xxはリトライして成功すれば結果を返す', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse([vec(1)]));
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never);

    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch);
    const result = await embedder.embed(['a']);

    expect(result).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('APIエラー（success:false）は即座に失敗する', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, errors: [{ message: 'invalid input' }] }),
    }));
    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch);

    await expect(embedder.embed(['a'])).rejects.toThrow('invalid input');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('次元数が1024でないベクトルはエラーにする', async () => {
    const fetchFn = vi.fn(async () => okResponse([[1, 2, 3]]));
    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch);
    await expect(embedder.embed(['a'])).rejects.toThrow('unexpected embedding dimensions');
  });

  it('ベクトル数が入力数と一致しない場合はエラーにする', async () => {
    const fetchFn = vi.fn(async () => okResponse([vec(1)]));
    const embedder = makeEmbedder(fetchFn as unknown as typeof fetch);
    await expect(embedder.embed(['a', 'b'])).rejects.toThrow('expected 2 vectors');
  });
});
