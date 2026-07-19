import { Hono } from 'hono';
import { z } from 'zod';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const idSchema = z.uuid();

const listConceptsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const conceptsRoute = new Hono<AppEnv>()
  // GET /concepts?q=&limit= — 概念一覧/検索（mentions数付き）
  .get('/', async (c) => {
    const parsed = listConceptsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    let query = dbClient(c)
      .from('concepts')
      .select('id, canonical_name, aliases, importance, concept_mentions(count)')
      .order('importance', { ascending: false })
      .limit(parsed.data.limit);
    if (parsed.data.q) {
      query = query.ilike('canonical_name', `%${parsed.data.q}%`);
    }
    const { data, error } = await query;
    if (error) {
      throw new ApiError('internal', `failed to list concepts: ${error.message}`);
    }
    const concepts = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      canonical_name: row.canonical_name,
      aliases: row.aliases,
      importance: row.importance,
      mention_count: (row.concept_mentions as { count: number }[] | null)?.[0]?.count ?? 0,
    }));
    return c.json({ concepts });
  })

  // GET /concepts/:id — 概念詳細（定義の出典別併記・出現書籍・関連概念1-hop）
  .get('/:id', async (c) => {
    const parsedId = idSchema.safeParse(c.req.param('id'));
    if (!parsedId.success) {
      throw new ApiError('validation_error', 'invalid concept id');
    }
    const db = dbClient(c);

    const { data: concept, error } = await db
      .from('concepts')
      .select('id, canonical_name, aliases, importance, created_at')
      .eq('id', parsedId.data)
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to fetch concept: ${error.message}`);
    }
    if (!concept) {
      throw new ApiError('not_found', 'concept not found');
    }

    // 定義は出典（書籍）別に併記する（KPS §10）
    const { data: mentions, error: mentionError } = await db
      .from('concept_mentions')
      .select('definition, document_id, documents(title), chunks(page_start, section_path)')
      .eq('concept_id', parsedId.data);
    if (mentionError) {
      throw new ApiError('internal', `failed to fetch mentions: ${mentionError.message}`);
    }
    const definitions = ((mentions ?? []) as Record<string, unknown>[]).map((row) => ({
      definition: row.definition,
      document_id: row.document_id,
      document_title: (row.documents as { title?: string } | null)?.title ?? null,
      page_start: (row.chunks as { page_start?: number } | null)?.page_start ?? null,
      section_path: (row.chunks as { section_path?: string } | null)?.section_path ?? null,
    }));

    // 関連概念（1-hop、双方向）
    const { data: links, error: linkError } = await db
      .from('concept_links')
      .select(
        'relation, source_concept_id, target_concept_id, source:concepts!concept_links_source_concept_id_fkey(id, canonical_name), target:concepts!concept_links_target_concept_id_fkey(id, canonical_name)',
      )
      .or(`source_concept_id.eq.${parsedId.data},target_concept_id.eq.${parsedId.data}`);
    if (linkError) {
      throw new ApiError('internal', `failed to fetch links: ${linkError.message}`);
    }
    const related = ((links ?? []) as Record<string, unknown>[]).map((row) => {
      const isSource = row.source_concept_id === parsedId.data;
      const other = (isSource ? row.target : row.source) as {
        id?: string;
        canonical_name?: string;
      } | null;
      return {
        concept_id: other?.id ?? null,
        canonical_name: other?.canonical_name ?? null,
        relation: row.relation,
        direction: isSource ? 'outgoing' : 'incoming',
      };
    });

    return c.json({ concept, definitions, related });
  });

/** GET /documents/:id/concepts — この本の概念一覧（mentions数付き）（06_API Content） */
export const documentConceptsRoute = new Hono<AppEnv>().get('/:id/concepts', async (c) => {
  const parsedId = idSchema.safeParse(c.req.param('id'));
  if (!parsedId.success) {
    throw new ApiError('validation_error', 'invalid document id');
  }
  const { data, error } = await dbClient(c)
    .from('concept_mentions')
    .select('concept_id, concepts(id, canonical_name, importance)')
    .eq('document_id', parsedId.data);
  if (error) {
    throw new ApiError('internal', `failed to fetch document concepts: ${error.message}`);
  }

  const byId = new Map<
    string,
    { id: string; canonical_name: string; importance: number; mention_count: number }
  >();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const concept = row.concepts as {
      id: string;
      canonical_name: string;
      importance: number;
    } | null;
    if (!concept) continue;
    const existing = byId.get(concept.id);
    if (existing) {
      existing.mention_count += 1;
    } else {
      byId.set(concept.id, { ...concept, mention_count: 1 });
    }
  }
  const concepts = [...byId.values()].sort((a, b) => b.importance - a.importance);
  return c.json({ concepts });
});
