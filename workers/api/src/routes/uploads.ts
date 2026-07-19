import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  completeUploadRequestSchema,
  EXT_BY_CONTENT_TYPE,
  IMAGE_MAX_BYTES,
  PDF_MAX_BYTES,
  r2UploadImageKey,
  r2UploadPdfKey,
  uploadUrlRequestSchema,
} from '@pkos/shared';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import { presignPutUrl } from '../r2-presign';
import type { AppEnv } from '../types';

const idSchema = z.uuid();

interface DocumentRow {
  id: string;
  user_id: string;
  status: string;
  r2_prefix: string;
}

async function fetchDocument(c: Context<AppEnv>, id: string): Promise<DocumentRow> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    throw new ApiError('validation_error', 'invalid document id');
  }
  const { data, error } = await dbClient(c)
    .from('documents')
    .select('id, user_id, status, r2_prefix')
    .eq('id', parsed.data)
    .maybeSingle();
  if (error) {
    throw new ApiError('internal', `failed to fetch document: ${error.message}`);
  }
  if (!data) {
    throw new ApiError('not_found', 'document not found');
  }
  return data as DocumentRow;
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError('validation_error', 'invalid JSON body');
  }
}

export const uploadsRoute = new Hono<AppEnv>()
  // POST /documents/:id/upload-url — R2署名付きPUT URL発行（15分有効）
  .post('/:id/upload-url', async (c) => {
    const parsed = uploadUrlRequestSchema.safeParse(await parseJsonBody(c.req.raw));
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    const { content_type, page_number } = parsed.data;
    const document = await fetchDocument(c, c.req.param('id'));
    const userId = c.get('userId');

    let r2Key: string;
    if (content_type === 'application/pdf') {
      r2Key = r2UploadPdfKey(userId, document.id);
    } else {
      if (page_number === undefined) {
        throw new ApiError('validation_error', 'page_number is required for image uploads');
      }
      r2Key = r2UploadImageKey(userId, document.id, page_number, EXT_BY_CONTENT_TYPE[content_type]);
    }

    // 最初のupload-url発行でstatusをuploadingへ（冪等）
    if (document.status === 'created') {
      await dbClient(c).from('documents').update({ status: 'uploading' }).eq('id', document.id);
    }

    const uploadUrl = await presignPutUrl(c.env, r2Key);
    return c.json({ upload_url: uploadUrl, r2_key: r2Key });
  })

  // POST /documents/:id/uploads/complete — サイズ/存在検証しpages行を作成
  .post('/:id/uploads/complete', async (c) => {
    const parsed = completeUploadRequestSchema.safeParse(await parseJsonBody(c.req.raw));
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    const document = await fetchDocument(c, c.req.param('id'));
    const { r2_keys: keys } = parsed.data;

    const uploadsPrefix = `${document.r2_prefix}uploads/`;
    for (const key of keys) {
      if (!key.startsWith(uploadsPrefix)) {
        throw new ApiError('validation_error', `r2_key is outside the document prefix: ${key}`);
      }
    }

    const bucket = c.env.R2;
    if (!bucket) {
      throw new ApiError('internal', 'R2 binding is not configured');
    }

    const isPdf = keys.length === 1 && keys[0]?.endsWith('.pdf');
    // TDD §6: 画像10MB / PDF100MB をアップロード完了時に検証
    for (const key of keys) {
      const head = await bucket.head(key);
      if (!head) {
        throw new ApiError('validation_error', `object not uploaded: ${key}`);
      }
      const maxBytes = key.endsWith('.pdf') ? PDF_MAX_BYTES : IMAGE_MAX_BYTES;
      if (head.size > maxBytes) {
        throw new ApiError('validation_error', `object exceeds size limit: ${key}`);
      }
    }

    const db = dbClient(c);
    if (!isPdf) {
      // 配列順 = ページ順。再実行に備えupsert
      const rows = keys.map((key, index) => ({
        user_id: document.user_id,
        document_id: document.id,
        page_number: index + 1,
        r2_image_key: key,
      }));
      const { error } = await db
        .from('pages')
        .upsert(rows, { onConflict: 'document_id,page_number' });
      if (error) {
        throw new ApiError('internal', `failed to create pages: ${error.message}`);
      }
    }

    // PDFのページ分解はバッチ（M2）が行い、その際にpage_countも確定する
    const { data: updated, error: updateError } = await db
      .from('documents')
      .update({ status: 'uploading', page_count: isPdf ? null : keys.length })
      .eq('id', document.id)
      .select()
      .single();
    if (updateError) {
      throw new ApiError('internal', `failed to update document: ${updateError.message}`);
    }
    return c.json({ document: updated });
  });
