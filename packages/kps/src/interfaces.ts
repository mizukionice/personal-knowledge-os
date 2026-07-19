import type { PageAnalysis } from '@pkos/shared';

/**
 * KPS §2 のパイプライン全ステージのインターフェース。
 * 実装は外部I/O（VLM API・DB・R2）をコンストラクタ注入し、ここは純粋な契約のみ。
 * 差し替え候補は docs/04_KPS.md の表を参照。
 */

// ---------- DocumentParser ----------

export interface PageImage {
  pageNumber: number;
  /** PNG画像バイト列 */
  data: Uint8Array;
}

/** PDF→ページ画像分解 */
export interface DocumentParser {
  parse(pdf: Uint8Array): Promise<PageImage[]>;
}

// ---------- PageAnalyzer ----------

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface PageAnalyzerInput {
  image: { data: Uint8Array; mediaType: ImageMediaType };
  pageNumber: number;
  /** 前ページの context_summary（先頭ページはundefined） */
  previousContextSummary?: string;
}

/** VLMによるページ理解（OCR+レイアウト+図表理解） */
export interface PageAnalyzer {
  analyze(input: PageAnalyzerInput): Promise<PageAnalysis>;
}

// ---------- Chunker ----------

export type ChunkType = 'text' | 'figure' | 'table' | 'formula';

export interface AnalyzedPage {
  pageNumber: number;
  analysis: PageAnalysis;
}

/** DB保存前のチャンク（idはDBが採番） */
export interface ChunkDraft {
  chunkType: ChunkType;
  content: string;
  /** 例: "第3章 > 3.2 リスク対応"。見出し不明ならnull */
  sectionPath: string | null;
  pageStart: number;
  pageEnd: number;
}

/** Semantic Chunking（KPS §4。固定長分割は使わない） */
export interface Chunker {
  chunk(pages: AnalyzedPage[]): ChunkDraft[];
}

// ---------- ConceptExtractor ----------

export interface ConceptDraft {
  canonicalName: string;
  aliases: string[];
  /** この書籍での定義（出典付き併記のためのソース） */
  definition: string;
  importance: number;
  /** 出現ページ番号（concept_mentions作成に使用） */
  pageNumbers: number[];
  /** 既存conceptと同定された場合そのid（新規はnull） */
  existingConceptId: string | null;
}

/** 既存Knowledge Base照合のためのルックアップ（実装はDB側で注入） */
export interface ConceptLookup {
  /** canonical name / aliasの完全一致検索 */
  findByName(name: string): Promise<{ id: string; canonicalName: string } | null>;
  /** embedding類似検索（cosine類似度 > threshold の候補） */
  findSimilar(
    embedding: number[],
    threshold: number,
  ): Promise<{ id: string; canonicalName: string; definition: string; similarity: number }[]>;
}

/** 概念抽出+正規化+既存照合（KPS §5） */
export interface ConceptExtractor {
  extract(pages: AnalyzedPage[], lookup: ConceptLookup): Promise<ConceptDraft[]>;
}

// ---------- RelationExtractor ----------

export const RELATION_TYPES = ['is_a', 'part_of', 'relates_to', 'contradicts', 'same_as'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export interface RelationDraft {
  sourceConceptName: string;
  relation: RelationType;
  targetConceptName: string;
  /** 根拠チャンク（chunks配列のインデックス）。evidenceのない関係は保存しない */
  evidenceChunkIndex: number;
}

/** 概念間関係の抽出（KPS §6） */
export interface RelationExtractor {
  extract(concepts: ConceptDraft[], chunks: ChunkDraft[]): Promise<RelationDraft[]>;
}

// ---------- Embedder ----------

/** BGE-M3等によるテキスト埋め込み（1024次元） */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- MemoryUpdater ----------

export interface MemoryUpdateResult {
  newConceptIds: string[];
  updatedConceptIds: string[];
  newContradictionCount: number;
}

/** 既存Knowledge Baseへの差分統合（KPS §10。全体再構築はしない） */
export interface MemoryUpdater {
  update(
    documentId: string,
    concepts: ConceptDraft[],
    relations: RelationDraft[],
  ): Promise<MemoryUpdateResult>;
}

// ---------- Retriever（M3） ----------

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  documentId: string;
  documentTitle: string;
  pageStart: number;
  sectionPath: string | null;
  score: number;
}

/** Hybrid Retrieval: vector + FTS + RRF + graph 1-hop（KPS §8） */
export interface Retriever {
  retrieve(query: string): Promise<RetrievedChunk[]>;
}

// ---------- Reasoner（M4） ----------

export interface Citation {
  documentId: string;
  documentTitle: string;
  page: number;
  sectionPath: string | null;
}

export interface ReasonerAnswer {
  /** 出典表記 [書名 p.145 §3.2] を含む回答本文 */
  answer: string;
  citations: Citation[];
  /** 蔵書に根拠が無く一般知識で答えた場合true */
  usedGeneralKnowledge: boolean;
}

/** 引用付き回答生成（KPS §9。Citation First） */
export interface Reasoner {
  answer(question: string, context: RetrievedChunk[]): Promise<ReasonerAnswer>;
}
