import { describe, expect, it } from 'vitest';
import type { PageAnalysis } from '@pkos/shared';

import { resolvePageMarkdown } from './resolve-page-markdown';

function analysis(overrides: Partial<PageAnalysis> = {}): PageAnalysis {
  return {
    markdown: '',
    page_type: 'content',
    sections: [],
    figures: [],
    tables: [],
    formulas: [],
    concepts: [],
    context_summary: '',
    ...overrides,
  };
}

describe('resolvePageMarkdown', () => {
  it('図参照をキャプション+説明文のブロックに展開する', () => {
    const result = resolvePageMarkdown(
      analysis({
        markdown: '## 5.2 プロトコルの階層化\n\n![プロトコルスタックの図](fig-1)\n\n本文が続く。',
        figures: [
          {
            id: 'fig-1',
            caption: '図5.4 プロトコルスタック',
            description: '各階層がヘッダを付加しながらPDUを下位層へ渡す流れを示す。',
          },
        ],
      }),
    );

    expect(result).toContain('> **図** 図5.4 プロトコルスタック');
    expect(result).toContain('> 各階層がヘッダを付加しながらPDUを下位層へ渡す流れを示す。');
    expect(result).not.toContain('fig-1');
  });

  it('キャプションが無い図は参照ラベルを見出しに使う', () => {
    const result = resolvePageMarkdown(
      analysis({
        markdown: '![レイヤ構成の概念図](fig-1)',
        figures: [{ id: 'fig-1', caption: '', description: 'OSI 7階層の構成を示す。' }],
      }),
    );

    expect(result).toContain('> **図** レイヤ構成の概念図');
    expect(result).toContain('> OSI 7階層の構成を示す。');
  });

  it('文中の図参照はブロックとして分離される（画像タグを残さない）', () => {
    const result = resolvePageMarkdown(
      analysis({
        markdown: 'ト層に渡す（![図5.4](fig-1)参照）。',
        figures: [{ id: 'fig-1', caption: '', description: '階層間のデータの流れ。' }],
      }),
    );

    expect(result).not.toContain('![');
    expect(result).toContain('> **図** 図5.4');
  });

  it('表参照を表本体+キャプションに展開する', () => {
    const result = resolvePageMarkdown(
      analysis({
        markdown: '前文。\n\n[表: PDUの名称](tbl-1)\n\n後文。',
        tables: [
          {
            id: 'tbl-1',
            caption: '表5.1 PDUの名称',
            markdown: '| 階層 | PDU |\n|---|---|\n| トランスポート | セグメント |',
          },
        ],
      }),
    );

    expect(result).toContain('**表** 表5.1 PDUの名称');
    expect(result).toContain('| トランスポート | セグメント |');
    expect(result).not.toContain('tbl-1');
  });

  it('figures配列に無いIDはラベルのみのブロックに退避する', () => {
    const result = resolvePageMarkdown(analysis({ markdown: '![未知の図](fig-9)' }));

    expect(result).toBe('> **図** 未知の図');
  });

  it('tables配列に無いIDはラベルのみに退避する（先頭の「表:」は除去）', () => {
    const result = resolvePageMarkdown(analysis({ markdown: '[表: 不明な表](tbl-9)' }));

    expect(result).toBe('**表** 不明な表');
  });

  it('リンク形式の図参照（!なし）も解決する', () => {
    const result = resolvePageMarkdown(
      analysis({
        markdown: '[図5.5](fig-2)',
        figures: [{ id: 'fig-2', caption: '図5.5 カプセル化', description: 'カプセル化の説明。' }],
      }),
    );

    expect(result).toContain('> **図** 図5.5 カプセル化');
  });

  it('図表参照が無いMarkdownはそのまま返す', () => {
    const result = resolvePageMarkdown(analysis({ markdown: '# 見出し\n\n本文。' }));

    expect(result).toBe('# 見出し\n\n本文。');
  });

  it('通常のURLリンク・画像は変換しない', () => {
    const markdown = '[参考](https://example.com) と ![alt](https://example.com/a.png)';
    const result = resolvePageMarkdown(analysis({ markdown }));

    expect(result).toBe(markdown);
  });

  it('冪等: 一度解決したMarkdownを再度解決しても変化しない', () => {
    const first = resolvePageMarkdown(
      analysis({
        markdown: '![図](fig-1)\n\n[表: 名称](tbl-1)',
        figures: [{ id: 'fig-1', caption: '図1', description: '説明。' }],
        tables: [{ id: 'tbl-1', caption: '表1', markdown: '| a |\n|---|\n| b |' }],
      }),
    );
    const second = resolvePageMarkdown(analysis({ markdown: first }));

    expect(second).toBe(first);
  });

  it('連続する参照の間で空行が過剰にならない', () => {
    const result = resolvePageMarkdown(
      analysis({
        markdown: '![図A](fig-1)\n![図B](fig-2)',
        figures: [
          { id: 'fig-1', caption: '', description: '図Aの説明。' },
          { id: 'fig-2', caption: '', description: '図Bの説明。' },
        ],
      }),
    );

    expect(result).not.toMatch(/\n{3,}/);
    expect(result.startsWith('>')).toBe(true);
    expect(result.endsWith('。')).toBe(true);
  });
});
