import { describe, expect, it } from 'vitest';
import type { PageAnalysis } from '@pkos/shared';

import type { AnalyzedPage } from '../interfaces';
import { SectionChunker } from './section-chunker';

function page(
  pageNumber: number,
  markdown: string,
  extra: Partial<PageAnalysis> = {},
): AnalyzedPage {
  return {
    pageNumber,
    analysis: {
      markdown,
      page_type: 'content',
      sections: [],
      figures: [],
      tables: [],
      formulas: [],
      concepts: [],
      context_summary: '',
      ...extra,
    },
  };
}

const chunker = new SectionChunker();

describe('SectionChunker', () => {
  it('見出し階層からsection_pathを構築しセクション単位で分割する', () => {
    const chunks = chunker.chunk([
      page(
        1,
        `# 第3章 リスク管理\n\n${'章の導入。'.repeat(20)}\n\n## 3.2 リスク対応\n\n${'対応戦略の本文。'.repeat(20)}`,
      ),
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.sectionPath).toBe('第3章 リスク管理');
    expect(chunks[1]?.sectionPath).toBe('第3章 リスク管理 > 3.2 リスク対応');
    expect(chunks[1]?.chunkType).toBe('text');
  });

  it('同レベルの見出しで階層が置き換わる', () => {
    const chunks = chunker.chunk([
      page(
        1,
        `# 第1章\n\n${'一章の本文。'.repeat(15)}\n\n## 1.1 節\n\n${'一節の本文。'.repeat(15)}\n\n# 第2章\n\n${'二章の本文。'.repeat(15)}`,
      ),
    ]);
    expect(chunks.map((c) => c.sectionPath)).toEqual(['第1章', '第1章 > 1.1 節', '第2章']);
  });

  it('セクションがページをまたぐとpage_start/page_endが範囲になる', () => {
    const chunks = chunker.chunk([
      page(1, `## 3.2 リスク対応\n\n${'ページ1の本文。'.repeat(10)}`),
      page(2, `${'ページ2の本文。'.repeat(10)}`),
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.pageStart).toBe(1);
    expect(chunks[0]?.pageEnd).toBe(2);
  });

  it('1500字を超えるセクションは段落境界で分割される', () => {
    const para = 'あ'.repeat(600);
    const chunks = chunker.chunk([page(1, `## 長い節\n\n${para}\n\n${para}\n\n${para}`)]);

    // 600*3=1800 > 1500 → [600+600, 600] に分割
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content.length).toBeGreaterThan(1000);
    expect(chunks[1]?.content.length).toBe(600);
    expect(chunks.every((c) => c.sectionPath === '長い節')).toBe(true);
    // 段落自体は分割しない
    expect(chunks[0]?.content).toBe(`${para}\n\n${para}`);
  });

  it('短いセクション（50〜200字）は独立チャンクとして保持される', () => {
    const shortBody = 'この節は短いが独立した意味を持つ文章です。'.repeat(3); // ~63字
    const chunks = chunker.chunk([
      page(1, `## 前の節\n\n${'前の節の本文。'.repeat(20)}\n\n## 短い節\n\n${shortBody}`),
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.sectionPath).toBe('短い節');
  });

  it('断片（<50字）は前のチャンクに併合される', () => {
    const chunks = chunker.chunk([
      page(1, `## 本文の節\n\n${'本文。'.repeat(30)}\n\n## 断片\n\nおわり`),
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionPath).toBe('本文の節');
    expect(chunks[0]?.content).toContain('おわり');
  });

  it('図・表はキャプション+説明で独立チャンクになる', () => {
    const chunks = chunker.chunk([
      page(3, `## 3.2 リスク対応\n\n${'本文。'.repeat(30)}`, {
        figures: [
          { id: 'fig-1', caption: '図3-2 リスクマトリクス', description: '2軸で分類する図。' },
        ],
        tables: [
          {
            id: 'tbl-1',
            caption: '表3-1 対応一覧',
            markdown: '| 戦略 | 説明 |\n|---|---|\n| 回避 | x |',
          },
        ],
      }),
    ]);

    const figure = chunks.find((c) => c.chunkType === 'figure');
    const table = chunks.find((c) => c.chunkType === 'table');
    expect(figure?.content).toBe('図3-2 リスクマトリクス\n2軸で分類する図。');
    expect(figure?.sectionPath).toBe('3.2 リスク対応');
    expect(figure?.pageStart).toBe(3);
    expect(table?.content).toContain('| 戦略 | 説明 |');
  });

  it('見出しのないページ（表紙など）はsection_path=nullで扱う', () => {
    const chunks = chunker.chunk([page(1, '書名だけが書かれた表紙のテキスト。'.repeat(4))]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionPath).toBeNull();
  });

  it('空のmarkdown（blankページ）はチャンクを生成しない', () => {
    expect(chunker.chunk([page(1, '', { page_type: 'blank' })])).toHaveLength(0);
  });

  it('見出しのみで本文が無いセクションはチャンクを生成しない', () => {
    const chunks = chunker.chunk([
      page(1, `# 第1章\n\n## 1.1 節\n\n${'一節の本文がここにある。'.repeat(10)}`),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionPath).toBe('第1章 > 1.1 節');
  });
});
