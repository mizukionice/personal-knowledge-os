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
}

/** バッチが必要とするR2操作 */
export interface ObjectStore {
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}
