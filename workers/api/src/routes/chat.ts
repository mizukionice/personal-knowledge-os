import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { chatRequestSchema, type ChatCitation } from '@pkos/shared';
import type { Embedder, RetrievedChunk } from '@pkos/kps/src/interfaces';
import {
  buildReasonerUserText,
  REASONER_SYSTEM_PROMPT_V1,
} from '@pkos/kps/src/prompts/reasoner.v1';
import { parseCitations } from '@pkos/kps/src/reasoner/citations';
import { compressContext } from '@pkos/kps/src/reasoner/context-compressor';
import { HybridRetriever, type RetrieverStore } from '@pkos/kps/src/retriever/hybrid-retriever';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

/** KPS §9: 検索結果チャンクは合計8000トークン以内 */
const CONTEXT_BUDGET = 8000;
const CHAT_MODEL = 'claude-opus-4-8';
const CHAT_MAX_TOKENS = 16000;

interface SearchChunkRow {
  chunk_id: string;
  content: string;
  document_id: string;
  document_title: string;
  page_start: number;
  section_path: string | null;
  score: number;
}

function toRetrievedChunk(row: SearchChunkRow): RetrievedChunk {
  return {
    chunkId: row.chunk_id,
    content: row.content,
    documentId: row.document_id,
    documentTitle: row.document_title,
    pageStart: row.page_start,
    sectionPath: row.section_path,
    score: row.score,
  };
}

/** POST /chat — SSEストリーム（06_API Chat / KPS §8-9） */
export const chatRoute = new Hono<AppEnv>().post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.raw.json();
  } catch {
    throw new ApiError('validation_error', 'invalid JSON body');
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('validation_error', z.prettifyError(parsed.error));
  }
  const { message, history } = parsed.data;

  const ai = c.env.AI;
  if (!ai) {
    throw new ApiError('internal', 'AI binding is not configured');
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ApiError('internal', 'ANTHROPIC_API_KEY is not configured');
  }

  const db = dbClient(c);
  const uid = c.get('userId');

  const embedder: Embedder = {
    embed: async (texts) => {
      const result = (await ai.run('@cf/baai/bge-m3' as keyof AiModels, { text: texts })) as {
        data?: number[][];
      };
      if (!result.data || result.data.length === 0) {
        throw new ApiError('internal', 'failed to embed chat query');
      }
      return result.data;
    },
  };

  const store: RetrieverStore = {
    searchChunks: async (embedding, query, limit) => {
      const { data, error } = await db.rpc('search_chunks', {
        query_embedding: JSON.stringify(embedding),
        query_text: query,
        uid,
        match_count: limit,
      });
      if (error) {
        throw new ApiError('internal', `search failed: ${error.message}`);
      }
      return ((data ?? []) as SearchChunkRow[]).map(toRetrievedChunk);
    },
    expandRelatedChunks: async (chunkIds, limit) => {
      const { data, error } = await db.rpc('expand_related_chunks', {
        source_chunk_ids: chunkIds,
        uid,
        match_count: limit,
      });
      if (error) {
        throw new ApiError('internal', `graph expansion failed: ${error.message}`);
      }
      return ((data ?? []) as SearchChunkRow[]).map(toRetrievedChunk);
    },
  };

  const retriever = new HybridRetriever(embedder, store);
  const retrieved = await retriever.retrieve(message);
  const context = compressContext(retrieved, CONTEXT_BUDGET);

  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user' as const, content: buildReasonerUserText(message, context) },
  ];

  return streamSSE(c, async (stream) => {
    try {
      const claudeStream = anthropic.messages.stream({
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        thinking: { type: 'adaptive' },
        system: REASONER_SYSTEM_PROMPT_V1,
        messages,
      });

      for await (const event of claudeStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          await stream.writeSSE({
            event: 'delta',
            data: JSON.stringify({ text: event.delta.text }),
          });
        }
      }

      const final = await claudeStream.finalMessage();
      const answer = final.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const { citations, usedGeneralKnowledge } = parseCitations(answer, context);
      const payload: { citations: ChatCitation[]; used_general_knowledge: boolean } = {
        citations: citations.map((citation) => ({
          document_id: citation.documentId,
          title: citation.documentTitle,
          page: citation.page,
          section_path: citation.sectionPath,
        })),
        used_general_knowledge: usedGeneralKnowledge,
      };
      await stream.writeSSE({ event: 'done', data: JSON.stringify(payload) });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'chat failed';
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
    }
  });
});
