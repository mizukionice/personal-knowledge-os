import * as mupdf from 'mupdf';

import type { ImageMediaType } from '../interfaces';

export interface VlmImage {
  data: Uint8Array;
  mediaType: ImageMediaType;
}

export interface PrepareImageOptions {
  /** これを超えるバイト数の画像だけを縮小対象にする */
  maxBytes?: number;
  /** 縮小時の長辺ピクセル数の上限 */
  maxLongEdge?: number;
}

// Claude APIはbase64エンコード後10MBまで（生バイトの約1.33倍）。
// 7MBなら base64 ≈ 9.3MB で確実に収まる
const DEFAULT_MAX_BYTES = 7 * 1024 * 1024;
// 1568px超はAPI側で自動縮小されるため、それを少し上回る解像度で十分
const DEFAULT_MAX_LONG_EDGE = 2000;
const JPEG_QUALITIES = [80, 60, 40];
const SCALE_STEP = 0.75;
const MAX_ATTEMPTS = 12;

/**
 * VLM送信前の画像正規化（写真アップロード対応）。
 * maxBytesを超える画像をmupdfで縮小しJPEG再エンコードする。R2の原本は変更しない。
 * PDF由来のレンダリング画像（150dpi PNG）は上限内なので無変換で通る。
 * mupdfが読めない形式（webp等）で上限超過の場合はエラー→ページ失敗として扱われる。
 */
export function prepareImageForVlm(image: VlmImage, options: PrepareImageOptions = {}): VlmImage {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLongEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;

  if (image.data.byteLength <= maxBytes) {
    return image;
  }

  const document = mupdf.Document.openDocument(image.data, image.mediaType);
  try {
    const page = document.loadPage(0);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      // 画像ドキュメントのboundsはDPIメタデータ依存のpt値だが、
      // toPixmapの出力ピクセル数は常に bounds * scale なのでptベースで目標を計算する
      const longEdgePt = Math.max(x1 - x0, y1 - y0);
      if (!(longEdgePt > 0)) {
        throw new Error('image has empty bounds');
      }

      let targetLongEdge = maxLongEdge;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const scale = targetLongEdge / longEdgePt;
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false,
        );
        try {
          for (const quality of JPEG_QUALITIES) {
            const jpeg = pixmap.asJPEG(quality, false);
            if (jpeg.byteLength <= maxBytes) {
              return { data: jpeg, mediaType: 'image/jpeg' };
            }
          }
        } finally {
          pixmap.destroy();
        }
        targetLongEdge = Math.max(1, Math.floor(targetLongEdge * SCALE_STEP));
      }
      throw new Error(`could not reduce image below ${maxBytes} bytes`);
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }
}
