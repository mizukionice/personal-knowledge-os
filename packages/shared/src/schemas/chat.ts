import { z } from 'zod';

/** POST /chat リクエスト（06_API Chat） */
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  /** 直近の会話履歴（古い順）。コンテキスト肥大を避けるため最大20件 */
  history: z.array(chatMessageSchema).max(20).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** SSE `done` イベントのcitation（06_API: {document_id, title, page, section_path}） */
export interface ChatCitation {
  document_id: string;
  title: string;
  page: number;
  section_path: string | null;
}
