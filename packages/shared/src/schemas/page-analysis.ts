import { z } from 'zod';

/**
 * PageAnalyzer（VLM）の出力スキーマ（KPS §3）。
 * VLM出力の欠落に耐えるよう、配列・要約はdefaultで補完する。
 */

export const pageTypeSchema = z.enum(['content', 'toc', 'cover', 'index', 'blank']);
export type PageType = z.infer<typeof pageTypeSchema>;

export const pageSectionSchema = z.object({
  level: z.number().int().min(1).max(6),
  title: z.string().min(1),
});
export type PageSection = z.infer<typeof pageSectionSchema>;

export const pageFigureSchema = z.object({
  id: z.string().min(1),
  caption: z.string().default(''),
  /** VLMによる図の説明文（検索・図表チャンクの本文になる） */
  description: z.string().min(1),
});
export type PageFigure = z.infer<typeof pageFigureSchema>;

export const pageTableSchema = z.object({
  id: z.string().min(1),
  caption: z.string().default(''),
  /** Markdown表に変換したもの */
  markdown: z.string().min(1),
});
export type PageTable = z.infer<typeof pageTableSchema>;

export const pageFormulaSchema = z.object({
  latex: z.string().min(1),
  explanation: z.string().default(''),
});
export type PageFormula = z.infer<typeof pageFormulaSchema>;

export const pageConceptSchema = z.object({
  /** 固有名詞・専門用語・手法名のみ（一般語は抽出しない） */
  name: z.string().min(1),
  name_ja: z.string().nullish(),
  /** このページでの定義・説明の要約 */
  definition: z.string().default(''),
  importance: z.number().min(0).max(1).default(0.5),
});
export type PageConcept = z.infer<typeof pageConceptSchema>;

export const pageAnalysisSchema = z.object({
  /** ページ全文の構造化Markdown（見出しレベル維持、図表は説明文で埋め込み） */
  markdown: z.string(),
  page_type: pageTypeSchema,
  sections: z.array(pageSectionSchema).default([]),
  figures: z.array(pageFigureSchema).default([]),
  tables: z.array(pageTableSchema).default([]),
  formulas: z.array(pageFormulaSchema).default([]),
  concepts: z.array(pageConceptSchema).default([]),
  /** 次ページへ渡す3文以内の文脈要約 */
  context_summary: z.string().default(''),
});
export type PageAnalysis = z.infer<typeof pageAnalysisSchema>;
