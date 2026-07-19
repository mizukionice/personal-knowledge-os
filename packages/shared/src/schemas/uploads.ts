import { z } from 'zod';

/** 06_API Upload — アップロード可能なcontent type（TDD §6: 画像10MB / PDF100MB） */

export const uploadContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
export type UploadContentType = z.infer<typeof uploadContentTypeSchema>;

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_BYTES = 100 * 1024 * 1024;

export const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const uploadUrlRequestSchema = z.object({
  file_name: z.string().trim().min(1).max(255),
  content_type: uploadContentTypeSchema,
  /** 画像の場合は必須（ページ順）。PDFでは不要 */
  page_number: z.number().int().min(1).max(2000).optional(),
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

export const uploadUrlResponseSchema = z.object({
  upload_url: z.url(),
  r2_key: z.string(),
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

export const completeUploadRequestSchema = z.object({
  /** アップロード済みキー。画像は並び順=ページ順。PDFは1要素のみ */
  r2_keys: z.array(z.string().min(1)).min(1).max(2000),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;
