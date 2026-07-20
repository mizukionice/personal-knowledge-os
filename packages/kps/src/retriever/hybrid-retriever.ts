import type { Embedder, RetrievedChunk, Retriever } from '../interfaces';

/**
 * Retrieverのデータアクセス（実装はAPI側でsearch_chunks / expand_related_chunks RPCを注入）。
 * user_idスコープはstore実装が担う。
 */
export interface RetrieverStore {
  /** Hybrid検索（vector + keyword + RRF）。KPS §8 手順1-3 */
  searchChunks(embedding: number[], query: string, limit: number): Promise<RetrievedChunk[]>;
  /** ヒットチャンクの概念1-hop先から関連チャンクを取得。KPS §8 手順4 */
  expandRelatedChunks(chunkIds: string[], limit: number): Promise<RetrievedChunk[]>;
}

export interface HybridRetrieverOptions {
  /** RRF統合後の取得件数（KPS §8: top 10） */
  searchLimit?: number;
  /** graph expansionの追加件数（KPS §8: 最大5件） */
  expandLimit?: number;
}

/** Hybrid Retrieval + Graph expansion（KPS §8） */
export class HybridRetriever implements Retriever {
  private readonly searchLimit: number;
  private readonly expandLimit: number;

  constructor(
    private readonly embedder: Embedder,
    private readonly store: RetrieverStore,
    options: HybridRetrieverOptions = {},
  ) {
    this.searchLimit = options.searchLimit ?? 10;
    this.expandLimit = options.expandLimit ?? 5;
  }

  async retrieve(query: string): Promise<RetrievedChunk[]> {
    const [embedding] = await this.embedder.embed([query]);
    if (!embedding) {
      throw new Error('failed to embed query');
    }

    const hits = await this.store.searchChunks(embedding, query, this.searchLimit);
    if (hits.length === 0) {
      return [];
    }

    const expanded = await this.store.expandRelatedChunks(
      hits.map((hit) => hit.chunkId),
      this.expandLimit,
    );

    const seen = new Set(hits.map((hit) => hit.chunkId));
    const results = [...hits];
    for (const chunk of expanded) {
      if (!seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        results.push(chunk);
      }
    }
    return results;
  }
}
