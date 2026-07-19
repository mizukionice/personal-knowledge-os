import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  ChunkInsert,
  ConceptInsert,
  Db,
  DocumentPatch,
  DocumentRow,
  JobPatch,
  JobRow,
  LinkInsert,
  MentionInsert,
  PagePatch,
  PageRow,
  SimilarConcept,
} from './types';

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

  async deleteDocumentKnowledge(documentId: string): Promise<void> {
    const { data: chunkRows, error: chunkError } = await this.client
      .from('chunks')
      .select('id')
      .eq('document_id', documentId);
    if (chunkError) throw new Error(`failed to list chunks: ${chunkError.message}`);
    const chunkIds = (chunkRows ?? []).map((row) => row.id as string);

    // concept_links.evidence_chunk_id はcascadeしないため先に削除する
    if (chunkIds.length > 0) {
      const { error } = await this.client
        .from('concept_links')
        .delete()
        .in('evidence_chunk_id', chunkIds);
      if (error) throw new Error(`failed to delete concept_links: ${error.message}`);
    }
    const { error: mentionError } = await this.client
      .from('concept_mentions')
      .delete()
      .eq('document_id', documentId);
    if (mentionError) throw new Error(`failed to delete mentions: ${mentionError.message}`);
    const { error: deleteError } = await this.client
      .from('chunks')
      .delete()
      .eq('document_id', documentId);
    if (deleteError) throw new Error(`failed to delete chunks: ${deleteError.message}`);
  }

  async insertChunks(rows: ChunkInsert[]): Promise<string[]> {
    const { data, error } = await this.client.from('chunks').insert(rows).select('id');
    if (error) throw new Error(`failed to insert chunks: ${error.message}`);
    return (data ?? []).map((row) => row.id as string);
  }

  async findConceptByName(
    userId: string,
    name: string,
  ): Promise<{ id: string; canonicalName: string } | null> {
    const { data, error } = await this.client
      .from('concepts')
      .select('id, canonical_name')
      .eq('user_id', userId)
      .eq('canonical_name', name)
      .maybeSingle();
    if (error) throw new Error(`failed to find concept: ${error.message}`);
    if (data) return { id: data.id as string, canonicalName: data.canonical_name as string };

    const { data: byAlias, error: aliasError } = await this.client
      .from('concepts')
      .select('id, canonical_name')
      .eq('user_id', userId)
      .contains('aliases', [name])
      .maybeSingle();
    if (aliasError) throw new Error(`failed to find concept by alias: ${aliasError.message}`);
    return byAlias
      ? { id: byAlias.id as string, canonicalName: byAlias.canonical_name as string }
      : null;
  }

  async findSimilarConcepts(
    userId: string,
    embedding: number[],
    threshold: number,
  ): Promise<SimilarConcept[]> {
    const { data, error } = await this.client.rpc('match_concepts', {
      query_embedding: JSON.stringify(embedding),
      uid: userId,
      similarity_threshold: threshold,
    });
    if (error) throw new Error(`failed to match concepts: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      canonicalName: row.canonical_name as string,
      definition: (row.definition as string) ?? '',
      similarity: row.similarity as number,
    }));
  }

  async upsertConcept(row: ConceptInsert): Promise<string> {
    const { data, error } = await this.client
      .from('concepts')
      .upsert(row, { onConflict: 'user_id,canonical_name' })
      .select('id')
      .single();
    if (error) throw new Error(`failed to upsert concept: ${error.message}`);
    return data.id as string;
  }

  async getConceptImportance(conceptId: string): Promise<number> {
    const { data, error } = await this.client
      .from('concepts')
      .select('importance')
      .eq('id', conceptId)
      .single();
    if (error) throw new Error(`failed to fetch concept: ${error.message}`);
    return data.importance as number;
  }

  async updateConcept(conceptId: string, patch: { importance?: number }): Promise<void> {
    const { error } = await this.client.from('concepts').update(patch).eq('id', conceptId);
    if (error) throw new Error(`failed to update concept: ${error.message}`);
  }

  async insertMentions(rows: MentionInsert[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client
      .from('concept_mentions')
      .upsert(rows, { onConflict: 'concept_id,chunk_id', ignoreDuplicates: true });
    if (error) throw new Error(`failed to insert mentions: ${error.message}`);
  }

  async insertLinks(rows: LinkInsert[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client.from('concept_links').upsert(rows, {
      onConflict: 'source_concept_id,target_concept_id,relation',
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`failed to insert links: ${error.message}`);
  }
}
