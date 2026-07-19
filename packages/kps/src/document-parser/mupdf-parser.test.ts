import { describe, expect, it } from 'vitest';

import { MupdfDocumentParser } from './mupdf-parser';

/** 2ページの最小PDF（xrefはmupdfの修復機能に任せる） */
const TWO_PAGE_PDF = new TextEncoder().encode(
  `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe('MupdfDocumentParser', () => {
  it('PDFをページ順のPNG画像に分解する', async () => {
    const parser = new MupdfDocumentParser();
    const pages = await parser.parse(TWO_PAGE_PDF);

    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    for (const page of pages) {
      expect(Array.from(page.data.slice(0, 4))).toEqual(PNG_MAGIC);
      expect(page.data.length).toBeGreaterThan(100);
    }
  });

  it('dpi指定で出力解像度が変わる', async () => {
    const low = await new MupdfDocumentParser({ dpi: 72 }).parse(TWO_PAGE_PDF);
    const high = await new MupdfDocumentParser({ dpi: 150 }).parse(TWO_PAGE_PDF);
    expect(high[0]!.data.length).toBeGreaterThan(low[0]!.data.length);
  });

  it('PDFでないバイト列はエラーになる', async () => {
    const parser = new MupdfDocumentParser();
    await expect(parser.parse(new TextEncoder().encode('not a pdf'))).rejects.toThrow();
  });
});
