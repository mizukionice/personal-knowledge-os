import type {
  AnalyzedPage,
  Chunker,
  ConceptExtractor,
  ConceptLookup,
  Embedder,
  RelationExtractor,
} from '@pkos/kps';

import type { Db, DocumentRow, MentionInsert } from './types';

export interface KnowledgeDeps {
  db: Db;
  chunker: Chunker;
  embedder: Embedder;
  conceptExtractor: ConceptExtractor;
  relationExtractor: RelationExtractor;
}

/**
 * M3 Knowledge化ステージ（KPS §4〜§6, §10）:
 * Chunker → Embedder → chunks保存 → ConceptExtractor → concepts/mentions保存
 * → RelationExtractor → links保存。
 * 全ページ成功時のみ呼ばれる。再実行時は既存のchunks/mentions/linksを作り直す
 * （conceptsはユーザー横断の知識なので削除しない = Incremental Learning）。
 */
export async function runKnowledgeStage(
  deps: KnowledgeDeps,
  document: DocumentRow,
  pages: AnalyzedPage[],
  log: (message: string) => void,
): Promise<void> {
  const { db, chunker, embedder, conceptExtractor, relationExtractor } = deps;

  // 1. Semantic Chunking + embedding
  const chunks = chunker.chunk(pages);
  if (chunks.length === 0) {
    log('knowledge stage: no chunks produced, skipping');
    return;
  }
  const chunkEmbeddings = await embedder.embed(chunks.map((chunk) => chunk.content));

  await db.deleteDocumentKnowledge(document.id);
  const chunkIds = await db.insertChunks(
    chunks.map((chunk, index) => ({
      user_id: document.user_id,
      document_id: document.id,
      chunk_type: chunk.chunkType,
      content: chunk.content,
      section_path: chunk.sectionPath,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      embedding: JSON.stringify(chunkEmbeddings[index]),
    })),
  );
  log(`knowledge stage: saved ${chunkIds.length} chunks`);

  // 2. 概念抽出（既存Knowledge Baseとの照合付き）
  const lookup: ConceptLookup = {
    findByName: (name) => db.findConceptByName(document.user_id, name),
    findSimilar: (embedding, threshold) =>
      db.findSimilarConcepts(document.user_id, embedding, threshold),
  };
  const concepts = await conceptExtractor.extract(pages, lookup);

  const newConcepts = concepts.filter((concept) => !concept.existingConceptId);
  const newEmbeddings = await embedder.embed(
    newConcepts.map((concept) => `${concept.canonicalName}\n${concept.definition}`),
  );

  const idByName = new Map<string, string>();
  let newIndex = 0;
  for (const concept of concepts) {
    if (concept.existingConceptId) {
      idByName.set(concept.canonicalName, concept.existingConceptId);
      // KPS §10: 新しい言及でimportanceを再計算（MVP: 最大値を採用）
      const current = await db.getConceptImportance(concept.existingConceptId);
      if (concept.importance > current) {
        await db.updateConcept(concept.existingConceptId, { importance: concept.importance });
      }
    } else {
      const id = await db.upsertConcept({
        user_id: document.user_id,
        canonical_name: concept.canonicalName,
        aliases: concept.aliases,
        importance: concept.importance,
        embedding: JSON.stringify(newEmbeddings[newIndex]),
      });
      newIndex += 1;
      idByName.set(concept.canonicalName, id);
    }
  }

  // 3. mentions: 概念の出現ページを含むtextチャンクに紐付ける（出典付き併記のためdefinitionを保存）
  const mentions: MentionInsert[] = [];
  for (const concept of concepts) {
    const conceptId = idByName.get(concept.canonicalName);
    if (!conceptId) continue;
    const chunkIndexes = new Set<number>();
    for (const pageNumber of concept.pageNumbers) {
      const index = chunks.findIndex(
        (chunk) =>
          chunk.chunkType === 'text' &&
          chunk.pageStart <= pageNumber &&
          pageNumber <= chunk.pageEnd,
      );
      if (index >= 0) chunkIndexes.add(index);
    }
    for (const index of chunkIndexes) {
      mentions.push({
        user_id: document.user_id,
        concept_id: conceptId,
        chunk_id: chunkIds[index]!,
        document_id: document.id,
        definition: concept.definition || null,
      });
    }
  }
  await db.insertMentions(mentions);
  log(
    `knowledge stage: ${concepts.length} concepts (${newConcepts.length} new, ${concepts.length - newConcepts.length} matched), ${mentions.length} mentions`,
  );

  // 4. 関係抽出（evidence必須）
  const relations = await relationExtractor.extract(concepts, chunks);
  const links = relations.flatMap((relation) => {
    const sourceId = idByName.get(relation.sourceConceptName);
    const targetId = idByName.get(relation.targetConceptName);
    const evidenceChunkId = chunkIds[relation.evidenceChunkIndex];
    if (!sourceId || !targetId || !evidenceChunkId) return [];
    return [
      {
        user_id: document.user_id,
        source_concept_id: sourceId,
        target_concept_id: targetId,
        relation: relation.relation,
        evidence_chunk_id: evidenceChunkId,
      },
    ];
  });
  await db.insertLinks(links);
  const contradictions = links.filter((link) => link.relation === 'contradicts').length;
  log(
    `knowledge stage: saved ${links.length} relations${contradictions > 0 ? ` (${contradictions} contradictions)` : ''}`,
  );
}
