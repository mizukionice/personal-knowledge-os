import type { PageAnalysis, PageFigure, PageTable } from '@pkos/shared';

/**
 * PageAnalyzer（KPS §3）が本文に埋め込む図表参照を表示可能なMarkdownへ展開する。
 *
 * VLM出力の本文は図を「![説明](fig-N)」、表を「[表: キャプション](tbl-N)」として
 * 参照するが、fig-N / tbl-N は analysis.figures / analysis.tables のIDであって
 * URLではない。そのまま配信するとビューアで壊れ画像・死にリンクになるため、
 * R2へ書き出す前に図は説明文ブロック、表は表本体へ置換する。
 * 切り出した図画像は存在しない（R2にはページ全体画像のみ）ので、画像ではなく
 * VLMが生成した説明文を図の位置に表示する。
 */
const REFERENCE_PATTERN = /!?\[([^\]]*)\]\(\s*((?:fig|tbl)-[^\s)]+)\s*\)/g;

export function resolvePageMarkdown(analysis: PageAnalysis): string {
  const figures = new Map(analysis.figures.map((figure) => [figure.id, figure]));
  const tables = new Map(analysis.tables.map((table) => [table.id, table]));

  return analysis.markdown
    .replace(REFERENCE_PATTERN, (_match, label: string, id: string) =>
      id.startsWith('fig-')
        ? figureBlock(label, figures.get(id))
        : tableBlock(label, tables.get(id)),
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function figureBlock(label: string, figure: PageFigure | undefined): string {
  const title = figure?.caption.trim() || label.trim() || '図';
  const lines = [`> **図** ${title}`];
  const description = figure?.description.trim() ?? '';
  if (description && description !== title) {
    lines.push('>');
    for (const line of description.split('\n')) {
      lines.push(`> ${line}`.trimEnd());
    }
  }
  return `\n\n${lines.join('\n')}\n\n`;
}

function tableBlock(label: string, table: PageTable | undefined): string {
  const caption = table?.caption.trim() || label.replace(/^表\s*[:：]\s*/, '').trim();
  const heading = caption ? `**表** ${caption}` : '**表**';
  const body = table?.markdown.trim() ?? '';
  return body ? `\n\n${heading}\n\n${body}\n\n` : `\n\n${heading}\n\n`;
}
