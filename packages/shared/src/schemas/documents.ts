import { z } from 'zod';

/** 05_DATABASE documentsテーブルに対応するAPIスキーマ（06_API） */

export const docTypeSchema = z.enum(['book', 'pdf', 'note']);
export type DocType = z.infer<typeof docTypeSchema>;

export const documentStatusSchema = z.enum([
  'created',
  'uploading',
  'processing',
  'completed',
  'failed',
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  title: z.string(),
  author: z.string().nullable(),
  doc_type: docTypeSchema,
  status: documentStatusSchema,
  page_count: z.number().int().nullable(),
  r2_prefix: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Document = z.infer<typeof documentSchema>;

export const createDocumentRequestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(200).optional(),
  doc_type: docTypeSchema.default('book'),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const listDocumentsQuerySchema = z.object({
  status: documentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

/** GET /documents/:id のpages進捗サマリ */
export const pagesSummarySchema = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  processing: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
});
export type PagesSummary = z.infer<typeof pagesSummarySchema>;
