import * as mupdf from 'mupdf';

import type { DocumentParser, PageImage } from '../interfaces';

const DEFAULT_DPI = 150;

/**
 * mupdf（WASM）によるDocumentParser実装。
 * ネイティブ依存が無いため、ローカル開発（Windows含む）とGitHub Actionsの
 * 両方で同一に動く。DPIはVLM入力用途（文字が読める解像度）として150をデフォルトにする。
 */
export class MupdfDocumentParser implements DocumentParser {
  private readonly dpi: number;

  constructor(options: { dpi?: number } = {}) {
    this.dpi = options.dpi ?? DEFAULT_DPI;
  }

  async parse(pdf: Uint8Array): Promise<PageImage[]> {
    const document = mupdf.Document.openDocument(pdf, 'application/pdf');
    try {
      const pageCount = document.countPages();
      const scale = this.dpi / 72;
      const images: PageImage[] = [];

      for (let index = 0; index < pageCount; index++) {
        const page = document.loadPage(index);
        try {
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB,
            false,
          );
          try {
            images.push({ pageNumber: index + 1, data: pixmap.asPNG() });
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      return images;
    } finally {
      document.destroy();
    }
  }
}
