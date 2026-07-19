/**
 * R2オブジェクトキーの命名規約（05_DATABASE: documents.r2_prefix = '{user_id}/{document_id}/'）。
 * キー生成をここに集約し、api / batch / kps で同一の規約を共有する。
 */

export function r2Prefix(userId: string, documentId: string): string {
  return `${userId}/${documentId}/`;
}

export function r2PageImageKey(userId: string, documentId: string, pageNumber: number): string {
  return `${r2Prefix(userId, documentId)}pages/${padPage(pageNumber)}.png`;
}

export function r2PageMarkdownKey(userId: string, documentId: string, pageNumber: number): string {
  return `${r2Prefix(userId, documentId)}markdown/${padPage(pageNumber)}.md`;
}

export function r2PageAnalysisKey(userId: string, documentId: string, pageNumber: number): string {
  return `${r2Prefix(userId, documentId)}analysis/${padPage(pageNumber)}.json`;
}

function padPage(pageNumber: number): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new RangeError(`pageNumber must be a positive integer, got: ${pageNumber}`);
  }
  return String(pageNumber).padStart(4, '0');
}

/** アップロード原本（写真1枚 = 1ページ）。extはcontent_typeから決まる（jpg/png/webp） */
export function r2UploadImageKey(
  userId: string,
  documentId: string,
  pageNumber: number,
  ext: 'jpg' | 'png' | 'webp',
): string {
  return `${r2Prefix(userId, documentId)}uploads/${padPage(pageNumber)}.${ext}`;
}

/** アップロード原本（PDFは1ドキュメント1ファイル） */
export function r2UploadPdfKey(userId: string, documentId: string): string {
  return `${r2Prefix(userId, documentId)}uploads/original.pdf`;
}

/** 全ページ結合Markdown（KPS §7） */
export function r2FullMarkdownKey(userId: string, documentId: string): string {
  return `${r2Prefix(userId, documentId)}markdown/full.md`;
}
