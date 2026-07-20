import { describe, expect, it } from 'vitest';

import type { RetrievedChunk } from '../interfaces';
import { NO_SOURCE_PHRASE, parseCitations } from './citations';

const context: RetrievedChunk[] = [
  {
    chunkId: 'c1',
    content: '...',
    documentId: 'doc-kumo',
    documentTitle: '蜘蛛の糸',
    pageStart: 1,
    sectionPath: '蜘蛛の糸 > 二',
    score: 1,
  },
  {
    chunkId: 'c2',
    content: '...',
    documentId: 'doc-net',
    documentTitle: '情報処理基礎',
    pageStart: 9,
    sectionPath: '5章 > 5.5 トランスポート層プロトコル > 5.5.4 TCP',
    score: 0.5,
  },
];

describe('parseCitations', () => {
  it('[書名 p.N §sec] 形式のcitationを抽出しdocument_idを解決する', () => {
    const answer =
      'TCPはコネクション指向である[情報処理基礎 p.9 §5.5.4 TCP]。犍陀多は糸を登った[蜘蛛の糸 p.1 §蜘蛛の糸 > 二]。';
    const result = parseCitations(answer, context);
    expect(result.citations).toEqual([
      {
        documentId: 'doc-net',
        documentTitle: '情報処理基礎',
        page: 9,
        sectionPath: '5.5.4 TCP',
      },
      {
        documentId: 'doc-kumo',
        documentTitle: '蜘蛛の糸',
        page: 1,
        sectionPath: '蜘蛛の糸 > 二',
      },
    ]);
    expect(result.usedGeneralKnowledge).toBe(false);
  });

  it('§なし [書名 p.N] も抽出できる', () => {
    const result = parseCitations('答え[蜘蛛の糸 p.1]。', context);
    expect(result.citations).toEqual([
      { documentId: 'doc-kumo', documentTitle: '蜘蛛の糸', page: 1, sectionPath: null },
    ]);
  });

  it('同一citationは重複排除する', () => {
    const result = parseCitations('A[蜘蛛の糸 p.1]。B[蜘蛛の糸 p.1]。', context);
    expect(result.citations).toHaveLength(1);
  });

  it('コンテキストに無い書名はdocumentId空で返す（回答文の引用はそのまま活かす）', () => {
    const result = parseCitations('X[未知の本 p.3]。', context);
    expect(result.citations).toEqual([
      { documentId: '', documentTitle: '未知の本', page: 3, sectionPath: null },
    ]);
  });

  it('「ライブラリにはこの情報がありません」を含むとusedGeneralKnowledge=true', () => {
    const result = parseCitations(`${NO_SOURCE_PHRASE}。一般知識では…`, context);
    expect(result.usedGeneralKnowledge).toBe(true);
    expect(result.citations).toEqual([]);
  });
});
