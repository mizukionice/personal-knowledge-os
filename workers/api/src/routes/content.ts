import { Hono } from 'hono';
import { z } from 'zod';
import { r2FullMarkdownKey, r2PageMarkdownKey } from '@pkos/shared';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

const idSchema = z.uuid();
const pageQuerySchema = z.coerce.number().int().min(1).max(2000);

/** GET /documents/:id/markdown — 結合Markdown（?page=n で単ページ）（06_API Content） */
export const contentRoute = new Hono<AppEnv>().get('/:id/markdown', async (c) => {
  const parsedId = idSchema.safeParse(c.req.param('id'));
  if (!parsedId.success) {
    throw new ApiError('validation_error', 'invalid document id');
  }

  const { data: document, error } = await dbClient(c)
    .from('documents')
    .select('id, user_id')
    .eq('id', parsedId.data)
    .maybeSingle();
  if (error) {
    throw new ApiError('internal', `failed to fetch document: ${error.message}`);
  }
  if (!document) {
    throw new ApiError('not_found', 'document not found');
  }

  const bucket = c.env.R2;
  if (!bucket) {
    throw new ApiError('internal', 'R2 binding is not configured');
  }

  const pageParam = c.req.query('page');
  let key: string;
  if (pageParam !== undefined) {
    const parsedPage = pageQuerySchema.safeParse(pageParam);
    if (!parsedPage.success) {
      throw new ApiError('validation_error', 'invalid page number');
    }
    key = r2PageMarkdownKey(document.user_id as string, document.id as string, parsedPage.data);
  } else {
    key = r2FullMarkdownKey(document.user_id as string, document.id as string);
  }

  const object = await bucket.get(key);
  if (!object) {
    throw new ApiError('not_found', 'markdown is not available yet');
  }
  return c.json({ markdown: await object.text() });
});
