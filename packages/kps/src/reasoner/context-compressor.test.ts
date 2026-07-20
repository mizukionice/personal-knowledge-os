import { describe, expect, it } from 'vitest';

import type { RetrievedChunk } from '../interfaces';
import { compressContext, estimateTokens } from './context-compressor';

function chunk(id: string, content: string): RetrievedChunk {
  return {
    chunkId: id,
    content,
    documentId: 'doc',
    documentTitle: 'title',
    pageStart: 1,
    sectionPath: null,
    score: 1,
  };
}

describe('estimateTokens', () => {
  it('日本語はおおむね1文字1トークン以上として見積もる', () => {
    expect(estimateTokens('こんにちは')).toBeGreaterThanOrEqual(5);
  });

  it('ASCIIは1文字1トークンより小さく見積もる', () => {
    expect(estimateTokens('hello world this is ascii')).toBeLessThan(25);
  });
});

describe('compressContext', () => {
  it('予算内なら全チャンクをそのまま返す', () => {
    const chunks = [chunk('a', 'あ'.repeat(100)), chunk('b', 'い'.repeat(100))];
    expect(compressContext(chunks, 1000)).toHaveLength(2);
  });

  it('予算を超えたら関連度順（入力順）に前から採用し、超過分を落とす', () => {
    const chunks = [
      chunk('a', 'あ'.repeat(400)),
      chunk('b', 'い'.repeat(400)),
      chunk('c', 'う'.repeat(400)),
    ];
    const result = compressContext(chunks, 900);
    expect(result.map((c) => c.chunkId)).toEqual(['a', 'b']);
  });

  it('先頭チャンク単体が予算超過なら予算内に切り詰めて返す', () => {
    const chunks = [chunk('a', 'あ'.repeat(2000))];
    const result = compressContext(chunks, 500);
    expect(result).toHaveLength(1);
    expect(estimateTokens(result[0]!.content)).toBeLessThanOrEqual(500);
    expect(result[0]!.content.length).toBeGreaterThan(0);
  });

  it('空入力は空配列', () => {
    expect(compressContext([], 8000)).toEqual([]);
  });
});
