import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import { prepareImageForVlm } from './image-preprocessor';

/** mupdfで指定ptサイズのPDFページをレンダリングし、実画像のPNGを作る */
function makePng(widthPt: number, heightPt: number, scale: number): Uint8Array {
  const pdf = new TextEncoder().encode(
    `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
  );
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  try {
    const page = doc.loadPage(0);
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
      );
      try {
        return pixmap.asPNG();
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

function imageSize(data: Uint8Array): { width: number; height: number } {
  const image = new mupdf.Image(data);
  try {
    return { width: image.getWidth(), height: image.getHeight() };
  } finally {
    image.destroy();
  }
}

const JPEG_MAGIC = [0xff, 0xd8];

describe('prepareImageForVlm', () => {
  it('maxBytes以下の画像はそのまま返す（再エンコードしない）', () => {
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const };
    const result = prepareImageForVlm(image, { maxBytes: 1024 });
    expect(result).toBe(image);
  });

  it('maxBytes超過の画像は長辺maxLongEdge以下のJPEGに縮小される', () => {
    const png = makePng(400, 200, 4); // 1600x800px
    const result = prepareImageForVlm(
      { data: png, mediaType: 'image/png' },
      { maxBytes: png.length - 1, maxLongEdge: 800 },
    );

    expect(result.mediaType).toBe('image/jpeg');
    expect(Array.from(result.data.slice(0, 2))).toEqual(JPEG_MAGIC);
    expect(result.data.length).toBeLessThanOrEqual(png.length - 1);
    const { width, height } = imageSize(result.data);
    expect(Math.max(width, height)).toBeLessThanOrEqual(800);
    // アスペクト比維持
    expect(width / height).toBeCloseTo(2, 1);
  });

  it('品質を下げても収まらない場合はさらに縮小してmaxBytesに収める', () => {
    const png = makePng(400, 200, 4);
    const maxBytes = 900; // JPEG q40でも収まらない程度に小さく
    const result = prepareImageForVlm(
      { data: png, mediaType: 'image/png' },
      { maxBytes, maxLongEdge: 1600 },
    );
    expect(result.data.length).toBeLessThanOrEqual(maxBytes);
    expect(result.mediaType).toBe('image/jpeg');
  });

  it('画像として解釈できないデータはエラーになる', () => {
    const junk = new Uint8Array(64).fill(7);
    expect(() =>
      prepareImageForVlm({ data: junk, mediaType: 'image/png' }, { maxBytes: 8 }),
    ).toThrow();
  });
});
