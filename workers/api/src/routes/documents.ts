import { Hono } from 'hono';
import { z } from 'zod';
import {
  createDocumentRequestSchema,
  listDocumentsQuerySchema,
  r2Prefix,
  type PagesSummary,
} from '@pkos/shared';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const idSchema = z.uuid();

function parseId(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('validation_error', 'invalid document id');
  }
  return parsed.data;
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError('validation_error', 'invalid JSON body');
  }
}

export const documentsRoute = new Hono<AppEnv>()
  // POST /documents — 作成
  .post('/', async (c) => {
    const parsed = createDocumentRequestSchema.safeParse(await parseJsonBody(c.req.raw));
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    const userId = c.get('userId');
    const id = crypto.randomUUID();
    const row = {
      id,
      user_id: userId,
      title: parsed.data.title,
      author: parsed.data.author ?? null,
      doc_type: parsed.data.doc_type,
      r2_prefix: r2Prefix(userId, id),
    };

    const { data, error } = await dbClient(c).from('documents').insert(row).select().single();
    if (error) {
      throw new ApiError('internal', `failed to create document: ${error.message}`);
    }
    return c.json({ document: data }, 201);
  })

  // GET /documents?status=&limit=&offset= — 一覧（RLSで自分の行のみ）
  .get('/', async (c) => {
    const parsed = listDocumentsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    const { status, limit, offset } = parsed.data;

    let query = dbClient(c)
      .from('documents')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new ApiError('internal', `failed to list documents: ${error.message}`);
    }
    return c.json({ documents: data ?? [], total: count ?? 0 });
  })

  // GET /documents/:id — 詳細（pages進捗サマリ含む）
  .get('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const db = dbClient(c);

    const { data: document, error } = await db
      .from('documents')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to fetch document: ${error.message}`);
    }
    if (!document) {
      throw new ApiError('not_found', 'document not found');
    }

    const { data: pages, error: pagesError } = await db
      .from('pages')
      .select('status')
      .eq('document_id', id);
    if (pagesError) {
      throw new ApiError('internal', `failed to fetch pages: ${pagesError.message}`);
    }

    const summary: PagesSummary = { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const page of (pages ?? []) as { status: string }[]) {
      summary.total += 1;
      if (page.status in summary) {
        summary[page.status as keyof Omit<PagesSummary, 'total'>] += 1;
      }
    }

    return c.json({ document: { ...document, pages_summary: summary } });
  })

  // DELETE /documents/:id — 削除（DB cascade + R2オブジェクト削除）
  .delete('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const db = dbClient(c);

    const { data: document, error } = await db
      .from('documents')
      .select('id, r2_prefix')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to fetch document: ${error.message}`);
    }
    if (!document) {
      throw new ApiError('not_found', 'document not found');
    }

    // R2はバインディングがある環境でのみ削除（RLSで自分のdocumentしか取れないため、
    // r2_prefixは必ず自分のuser_id配下になる）
    const bucket = c.env.R2;
    if (bucket) {
      let cursor: string | undefined;
      do {
        const listed = await bucket.list({ prefix: document.r2_prefix, cursor });
        if (listed.objects.length > 0) {
          await bucket.delete(listed.objects.map((obj) => obj.key));
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    }

    const { error: deleteError } = await db.from('documents').delete().eq('id', id);
    if (deleteError) {
      throw new ApiError('internal', `failed to delete document: ${deleteError.message}`);
    }
    return c.body(null, 204);
  });
