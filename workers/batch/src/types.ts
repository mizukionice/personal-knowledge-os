export interface JobRow {
  id: string;
  user_id: string;
  document_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string | null;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  title: string;
  doc_type: 'book' | 'pdf' | 'note';
  status: string;
  page_count: number | null;
  r2_prefix: string;
}

export interface PageRow {
  id: string;
  user_id: string;
  document_id: string;
  page_number: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  page_type: string | null;
  r2_image_key: string;
  r2_markdown_key: string | null;
  r2_analysis_key: string | null;
  error: string | null;
}

export interface PagePatch {
  status?: PageRow['status'];
  page_type?: string;
  r2_markdown_key?: string;
  r2_analysis_key?: string;
  error?: string | null;
}

export interface JobPatch {
  status?: JobRow['status'];
  progress?: number;
  error?: string | null;
  started_at?: string;
  finished_at?: string;
}

export interface DocumentPatch {
  status?: string;
  page_count?: number;
}

export interface ChunkInsert {
  user_id: string;
  document_id: string;
  chunk_type: string;
  content: string;
  section_path: string | null;
  page_start: number;
  page_end: number;
  /** pgvector形式のJSON配列文字列 */
  embedding: string;
}

export interface ConceptInsert {
  user_id: string;
  canonical_name: string;
  aliases: string[];
  importance: number;
  embedding: string;
}

export interface MentionInsert {
  user_id: string;
  concept_id: string;
  chunk_id: string;
  document_id: string;
  definition: string | null;
}

export interface LinkInsert {
  user_id: string;
  source_concept_id: string;
  target_concept_id: string;
  relation: string;
  evidence_chunk_id: string;
}

export interface SimilarConcept {
  id: string;
  canonicalName: string;
  definition: string;
  similarity: number;
}

/** バッチが必要とするDB操作（service roleで実行、RLSバイパス） */
export interface Db {
  /** queuedのjobをprocessingへ原子的に更新して取得。取れなければnull（多重起動対策） */
  claimJob(jobId: string): Promise<JobRow | null>;
  getDocument(documentId: string): Promise<DocumentRow>;
  listPages(documentId: string): Promise<PageRow[]>;
  upsertPages(
    rows: Pick<PageRow, 'user_id' | 'document_id' | 'page_number' | 'r2_image_key'>[],
  ): Promise<void>;
  updatePage(pageId: string, patch: PagePatch): Promise<void>;
  updateJob(jobId: string, patch: JobPatch): Promise<void>;
  updateDocument(documentId: string, patch: DocumentPatch): Promise<void>;

  // --- M3: Knowledge化 ---
  /** 再処理に備え、document配下のchunks / mentions / links を削除する */
  deleteDocumentKnowledge(documentId: string): Promise<void>;
  /** 挿入順のchunk idを返す */
  insertChunks(rows: ChunkInsert[]): Promise<string[]>;
  findConceptByName(
    userId: string,
    name: string,
  ): Promise<{ id: string; canonicalName: string } | null>;
  findSimilarConcepts(
    userId: string,
    embedding: number[],
    threshold: number,
  ): Promise<SimilarConcept[]>;
  /** unique(user_id, canonical_name) 衝突時は既存行を更新してidを返す */
  upsertConcept(row: ConceptInsert): Promise<string>;
  getConceptImportance(conceptId: string): Promise<number>;
  updateConcept(conceptId: string, patch: { importance?: number }): Promise<void>;
  insertMentions(rows: MentionInsert[]): Promise<void>;
  insertLinks(rows: LinkInsert[]): Promise<void>;
}

/** バッチが必要とするR2操作 */
export interface ObjectStore {
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}
