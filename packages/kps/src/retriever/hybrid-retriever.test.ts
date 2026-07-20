import { describe, expect, it, vi } from 'vitest';

import type { RetrievedChunk } from '../interfaces';
import { HybridRetriever, type RetrieverStore } from './hybrid-retriever';

function chunk(id: string, score: number): RetrievedChunk {
  return {
    chunkId: id,
    content: `content-${id}`,
    documentId: 'doc-1',
    documentTitle: '蜘蛛の糸',
    pageStart: 1,
    sectionPath: '一',
    score,
  };
}

function makeDeps(searchResult: RetrievedChunk[], expandResult: RetrievedChunk[]) {
  const embedder = { embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]) };
  const store: RetrieverStore = {
    searchChunks: vi.fn().mockResolvedValue(searchResult),
    expandRelatedChunks: vi.fn().mockResolvedValue(expandResult),
  };
  return { embedder, store };
}

describe('HybridRetriever', () => {
  it('検索ヒットにgraph expansionの関連チャンクを追記して返す', async () => {
    const { embedder, store } = makeDeps([chunk('a', 0.5), chunk('b', 0.4)], [chunk('c', 0.1)]);
    const retriever = new HybridRetriever(embedder, store);

    const results = await retriever.retrieve('地獄の糸');

    expect(results.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
    expect(embedder.embed).toHaveBeenCalledWith(['地獄の糸']);
    expect(store.searchChunks).toHaveBeenCalledWith([0.1, 0.2, 0.3], '地獄の糸', 10);
    expect(store.expandRelatedChunks).toHaveBeenCalledWith(['a', 'b'], 5);
  });

  it('expansionが検索ヒットと重複するチャンクを返しても重複させない', async () => {
    const { embedder, store } = makeDeps([chunk('a', 0.5)], [chunk('a', 0.2), chunk('d', 0.1)]);
    const retriever = new HybridRetriever(embedder, store);

    const results = await retriever.retrieve('q');

    expect(results.map((r) => r.chunkId)).toEqual(['a', 'd']);
    // 検索ヒット側のscoreを保持する
    expect(results[0]!.score).toBe(0.5);
  });

  it('検索ヒットが0件ならexpansionを行わず空配列を返す', async () => {
    const { embedder, store } = makeDeps([], [chunk('x', 0.1)]);
    const retriever = new HybridRetriever(embedder, store);

    const results = await retriever.retrieve('q');

    expect(results).toEqual([]);
    expect(store.expandRelatedChunks).not.toHaveBeenCalled();
  });

  it('検索件数・expansion件数はオプションで変更できる', async () => {
    const { embedder, store } = makeDeps([chunk('a', 0.5)], []);
    const retriever = new HybridRetriever(embedder, store, { searchLimit: 3, expandLimit: 2 });

    await retriever.retrieve('q');

    expect(store.searchChunks).toHaveBeenCalledWith(expect.anything(), 'q', 3);
    expect(store.expandRelatedChunks).toHaveBeenCalledWith(['a'], 2);
  });
});
