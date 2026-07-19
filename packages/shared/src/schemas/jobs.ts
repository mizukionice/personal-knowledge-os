import { z } from 'zod';

/** 05_DATABASE jobsテーブルに対応するAPIスキーマ（06_API Processing） */

export const jobStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  document_id: z.uuid(),
  job_type: z.string(),
  status: jobStatusSchema,
  /** 0-100 */
  progress: z.number().int(),
  error: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
});
export type Job = z.infer<typeof jobSchema>;

export const listJobsQuerySchema = z.object({
  document_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;
