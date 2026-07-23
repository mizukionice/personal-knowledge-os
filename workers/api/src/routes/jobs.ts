import { Hono } from 'hono';
import { z } from 'zod';
import { listJobsQuerySchema } from '@pkos/shared';

import { dbClient } from '../db';
import { ApiError } from '../errors';
import { dispatchProcessJob } from '../github-dispatch';
import { requirePermission } from '../middleware/permissions';
import type { AppEnv } from '../types';

const idSchema = z.uuid();

/** POST /documents/:id/process — job作成 + repository_dispatch → 202 {job} */
export const processRoute = new Hono<AppEnv>().post(
  '/:id/process',
  requirePermission('can_process'),
  async (c) => {
    const parsedId = idSchema.safeParse(c.req.param('id'));
    if (!parsedId.success) {
      throw new ApiError('validation_error', 'invalid document id');
    }
    const db = dbClient(c);

    const { data: document, error: docError } = await db
      .from('documents')
      .select('id, user_id')
      .eq('id', parsedId.data)
      .maybeSingle();
    if (docError) {
      throw new ApiError('internal', `failed to fetch document: ${docError.message}`);
    }
    if (!document) {
      throw new ApiError('not_found', 'document not found');
    }

    const { data: job, error: insertError } = await db
      .from('jobs')
      .insert({ user_id: c.get('userId'), document_id: document.id })
      .select()
      .single();
    if (insertError) {
      // 同一documentのアクティブjobはDBのpartial unique indexで1つに制限される
      if (insertError.code === '23505') {
        throw new ApiError('validation_error', 'document is already queued or processing');
      }
      throw new ApiError('internal', `failed to create job: ${insertError.message}`);
    }

    try {
      await dispatchProcessJob(c.env.GITHUB_REPO, c.env.GITHUB_DISPATCH_TOKEN, job.id as string);
    } catch (e) {
      // dispatchできなかったjobはqueuedのまま残さない
      await db
        .from('jobs')
        .update({ status: 'failed', error: 'failed to dispatch batch workflow' })
        .eq('id', job.id as string);
      throw new ApiError(
        'internal',
        e instanceof Error ? e.message : 'failed to dispatch batch workflow',
      );
    }

    return c.json({ job }, 202);
  },
);

export const jobsRoute = new Hono<AppEnv>()
  // GET /jobs?document_id= — job一覧
  .get('/', async (c) => {
    const parsed = listJobsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new ApiError('validation_error', z.prettifyError(parsed.error));
    }
    let query = dbClient(c)
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parsed.data.limit);
    if (parsed.data.document_id) {
      query = query.eq('document_id', parsed.data.document_id);
    }
    const { data, error } = await query;
    if (error) {
      throw new ApiError('internal', `failed to list jobs: ${error.message}`);
    }
    return c.json({ jobs: data ?? [] });
  })

  // GET /jobs/:id — 進捗
  .get('/:id', async (c) => {
    const parsedId = idSchema.safeParse(c.req.param('id'));
    if (!parsedId.success) {
      throw new ApiError('validation_error', 'invalid job id');
    }
    const { data, error } = await dbClient(c)
      .from('jobs')
      .select('*')
      .eq('id', parsedId.data)
      .maybeSingle();
    if (error) {
      throw new ApiError('internal', `failed to fetch job: ${error.message}`);
    }
    if (!data) {
      throw new ApiError('not_found', 'job not found');
    }
    return c.json({ job: data });
  });
