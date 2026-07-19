import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Db, DocumentPatch, DocumentRow, JobPatch, JobRow, PagePatch, PageRow } from './types';

export class SupabaseDb implements Db {
  private readonly client: SupabaseClient;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async claimJob(jobId: string): Promise<JobRow | null> {
    // status='queued' 条件付きupdateで原子的にclaimする（TDD §4）
    const { data, error } = await this.client
      .from('jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'queued')
      .select()
      .maybeSingle();
    if (error) throw new Error(`failed to claim job: ${error.message}`);
    return (data as JobRow | null) ?? null;
  }

  async getDocument(documentId: string): Promise<DocumentRow> {
    const { data, error } = await this.client
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();
    if (error) throw new Error(`failed to fetch document: ${error.message}`);
    return data as DocumentRow;
  }

  async listPages(documentId: string): Promise<PageRow[]> {
    const { data, error } = await this.client
      .from('pages')
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true });
    if (error) throw new Error(`failed to list pages: ${error.message}`);
    return (data ?? []) as PageRow[];
  }

  async upsertPages(
    rows: Pick<PageRow, 'user_id' | 'document_id' | 'page_number' | 'r2_image_key'>[],
  ): Promise<void> {
    const { error } = await this.client
      .from('pages')
      .upsert(rows, { onConflict: 'document_id,page_number' });
    if (error) throw new Error(`failed to upsert pages: ${error.message}`);
  }

  async updatePage(pageId: string, patch: PagePatch): Promise<void> {
    const { error } = await this.client.from('pages').update(patch).eq('id', pageId);
    if (error) throw new Error(`failed to update page: ${error.message}`);
  }

  async updateJob(jobId: string, patch: JobPatch): Promise<void> {
    const { error } = await this.client.from('jobs').update(patch).eq('id', jobId);
    if (error) throw new Error(`failed to update job: ${error.message}`);
  }

  async updateDocument(documentId: string, patch: DocumentPatch): Promise<void> {
    const { error } = await this.client.from('documents').update(patch).eq('id', documentId);
    if (error) throw new Error(`failed to update document: ${error.message}`);
  }
}
