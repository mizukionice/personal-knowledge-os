import { describe, expect, it } from 'vitest';
import {
  r2PageAnalysisKey,
  r2PageImageKey,
  r2PageMarkdownKey,
  r2Prefix,
  r2UploadImageKey,
  r2UploadPdfKey,
} from './r2-keys';

const USER = 'user-123';
const DOC = 'doc-456';

describe('r2Prefix', () => {
  it('user_id/document_id/ 形式を返す', () => {
    expect(r2Prefix(USER, DOC)).toBe('user-123/doc-456/');
  });
});

describe('page keys', () => {
  it('ページ番号を4桁ゼロ埋めする', () => {
    expect(r2PageImageKey(USER, DOC, 1)).toBe('user-123/doc-456/pages/0001.png');
    expect(r2PageMarkdownKey(USER, DOC, 42)).toBe('user-123/doc-456/markdown/0042.md');
    expect(r2PageAnalysisKey(USER, DOC, 1234)).toBe('user-123/doc-456/analysis/1234.json');
  });

  it('0以下・非整数のページ番号は拒否する', () => {
    expect(() => r2PageImageKey(USER, DOC, 0)).toThrow(RangeError);
    expect(() => r2PageImageKey(USER, DOC, -1)).toThrow(RangeError);
    expect(() => r2PageImageKey(USER, DOC, 1.5)).toThrow(RangeError);
  });
});

describe('upload keys', () => {
  it('画像はuploads/配下に拡張子付きで置く', () => {
    expect(r2UploadImageKey(USER, DOC, 3, 'jpg')).toBe('user-123/doc-456/uploads/0003.jpg');
  });

  it('PDFはuploads/original.pdf固定', () => {
    expect(r2UploadPdfKey(USER, DOC)).toBe('user-123/doc-456/uploads/original.pdf');
  });
});
