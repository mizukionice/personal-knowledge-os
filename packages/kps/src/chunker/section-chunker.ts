import type { AnalyzedPage, Chunker, ChunkDraft } from '../interfaces';

/**
 * Semantic Chunking（KPS §4）。固定長分割は使わない。
 * 1. 第一分割はセクション（見出し）単位。見出し階層からsection_pathを構築する
 * 2. 長いセクション（>1500字）は段落境界で分割する
 * 3. 短すぎるセクション（<200字）は次セクションと結合しない（見出しの意味を保つ）。
 *    ただし単独で意味を成さない断片（<50字）は前チャンクに併合する
 * 4. 各チャンクは section_path / page_start / page_end / chunk_type を保持する
 * 5. 図・表はキャプション+説明文で独立チャンクにする（図表検索のため）
 */

const MAX_SECTION_CHARS = 1500;
const MIN_STANDALONE_CHARS = 50;

interface Paragraph {
  text: string;
  pageStart: number;
  pageEnd: number;
}

interface SectionBlock {
  path: string | null;
  paragraphs: Paragraph[];
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

export class SectionChunker implements Chunker {
  chunk(pages: AnalyzedPage[]): ChunkDraft[] {
    const { blocks, media } = collectBlocks(pages);
    const textChunks = buildTextChunks(blocks);
    return [...textChunks, ...media];
  }
}

function collectBlocks(pages: AnalyzedPage[]): { blocks: SectionBlock[]; media: ChunkDraft[] } {
  const stack: { level: number; title: string }[] = [];
  const blocks: SectionBlock[] = [];
  const media: ChunkDraft[] = [];

  const currentPath = (): string | null =>
    stack.length > 0 ? stack.map((h) => h.title).join(' > ') : null;

  let block: SectionBlock | null = null;
  let openParagraph: Paragraph | null = null;

  const closeParagraph = () => {
    if (openParagraph && openParagraph.text.trim() !== '') {
      block?.paragraphs.push({ ...openParagraph, text: openParagraph.text.trim() });
    }
    openParagraph = null;
  };
  const closeBlock = () => {
    closeParagraph();
    if (block && block.paragraphs.length > 0) {
      blocks.push(block);
    }
    block = null;
  };

  for (const page of pages) {
    for (const rawLine of page.analysis.markdown.split('\n')) {
      const line = rawLine.trimEnd();
      const heading = HEADING_RE.exec(line.trim());

      if (heading?.[1] && heading[2]) {
        closeBlock();
        const level = heading[1].length;
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
          stack.pop();
        }
        stack.push({ level, title: heading[2].trim() });
        block = { path: currentPath(), paragraphs: [] };
        continue;
      }

      if (line.trim() === '') {
        closeParagraph();
        continue;
      }

      if (!block) {
        block = { path: currentPath(), paragraphs: [] };
      }
      if (!openParagraph) {
        openParagraph = { text: '', pageStart: page.pageNumber, pageEnd: page.pageNumber };
      }
      openParagraph.text += (openParagraph.text ? '\n' : '') + line;
      openParagraph.pageEnd = page.pageNumber;
    }

    // 図・表はこのページ時点のsection_pathで独立チャンクにする（KPS §4-5）
    for (const figure of page.analysis.figures) {
      const content = [figure.caption, figure.description].filter(Boolean).join('\n').trim();
      if (content) {
        media.push({
          chunkType: 'figure',
          content,
          sectionPath: currentPath(),
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
        });
      }
    }
    for (const table of page.analysis.tables) {
      const content = [table.caption, table.markdown].filter(Boolean).join('\n').trim();
      if (content) {
        media.push({
          chunkType: 'table',
          content,
          sectionPath: currentPath(),
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
        });
      }
    }
  }
  closeBlock();

  return { blocks, media };
}

function buildTextChunks(blocks: SectionBlock[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];

  for (const block of blocks) {
    const totalLength = block.paragraphs.reduce((sum, p) => sum + p.text.length, 0);

    // 断片（<50字）は単独で意味を成さないとみなし、直前のtextチャンクに併合する
    if (totalLength < MIN_STANDALONE_CHARS) {
      const previous = chunks[chunks.length - 1];
      const fragment = block.paragraphs.map((p) => p.text).join('\n\n');
      if (previous) {
        previous.content += `\n\n${fragment}`;
        previous.pageEnd = Math.max(previous.pageEnd, block.paragraphs.at(-1)!.pageEnd);
      } else {
        chunks.push(makeChunk(block.path, block.paragraphs));
      }
      continue;
    }

    if (totalLength <= MAX_SECTION_CHARS) {
      chunks.push(makeChunk(block.path, block.paragraphs));
      continue;
    }

    // 長いセクションは段落境界で貪欲に分割する（段落自体は分割しない）
    let group: Paragraph[] = [];
    let groupLength = 0;
    for (const paragraph of block.paragraphs) {
      if (group.length > 0 && groupLength + paragraph.text.length > MAX_SECTION_CHARS) {
        chunks.push(makeChunk(block.path, group));
        group = [];
        groupLength = 0;
      }
      group.push(paragraph);
      groupLength += paragraph.text.length;
    }
    if (group.length > 0) {
      chunks.push(makeChunk(block.path, group));
    }
  }

  return chunks;
}

function makeChunk(path: string | null, paragraphs: Paragraph[]): ChunkDraft {
  return {
    chunkType: 'text',
    content: paragraphs.map((p) => p.text).join('\n\n'),
    sectionPath: path,
    pageStart: Math.min(...paragraphs.map((p) => p.pageStart)),
    pageEnd: Math.max(...paragraphs.map((p) => p.pageEnd)),
  };
}
