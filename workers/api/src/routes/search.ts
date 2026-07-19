import { Hono } from 'hono';
import { z } from 'zod';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** GET /search?q= — Hybrid検索（06_API Knowledge） */
export const searchRoute = new Hono<AppEnv>().get('/', async (c) => {
  const parsed = searchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new ApiError('validation_error', z.prettifyError(parsed.error));
  }
  const { q, limit } = parsed.data;

  const ai = c.env.AI;
  if (!ai) {
    throw new ApiError('internal', 'AI binding is not configured');
  }
  const embedding = await embedQuery(ai, q);

  const { data, error } = await dbClient(c).rpc('search_chunks', {
    query_embedding: JSON.stringify(embedding),
    query_text: q,
    uid: c.get('userId'),
    match_count: limit,
  });
  if (error) {
    throw new ApiError('internal', `search failed: ${error.message}`);
  }
  return c.json({ results: data ?? [] });
});

async function embedQuery(ai: Ai, query: string): Promise<number[]> {
  const result = (await ai.run('@cf/baai/bge-m3' as keyof AiModels, { text: [query] })) as {
    data?: number[][];
  };
  const vector = result.data?.[0];
  if (!vector || vector.length === 0) {
    throw new ApiError('internal', 'failed to embed search query');
  }
  return vector;
}
