import type { Citation, RetrievedChunk } from '../interfaces';

/** 蔵書に根拠が無い場合にReasonerが必ず含める定型句（プロンプトで強制） */
export const NO_SOURCE_PHRASE = 'あなたのライブラリにはこの情報がありません';

/** `[書名 p.145 §3.2]` / `[書名 p.145]` 形式 */
const CITATION_PATTERN = /\[([^[\]]+?)\s+p\.(\d+)(?:\s+§([^[\]]+?))?\]/g;

export interface ParsedCitations {
  citations: Citation[];
  usedGeneralKnowledge: boolean;
}

/**
 * 回答文からcitationを抽出し、コンテキストチャンクの書名と突き合わせて
 * document_idを解決する（KPS §9 / 06_API Chat）。
 */
export function parseCitations(answer: string, context: RetrievedChunk[]): ParsedCitations {
  const titleToDocId = new Map<string, string>();
  for (const chunk of context) {
    titleToDocId.set(chunk.documentTitle, chunk.documentId);
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(CITATION_PATTERN)) {
    const [, rawTitle, rawPage, rawSection] = match;
    const title = rawTitle!.trim();
    const page = Number(rawPage);
    const sectionPath = rawSection?.trim() ?? null;
    const key = `${title}|${page}|${sectionPath ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      documentId: titleToDocId.get(title) ?? '',
      documentTitle: title,
      page,
      sectionPath,
    });
  }

  return { citations, usedGeneralKnowledge: answer.includes(NO_SOURCE_PHRASE) };
}
