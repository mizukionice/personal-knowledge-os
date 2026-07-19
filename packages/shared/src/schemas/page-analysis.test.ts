import { describe, expect, it } from 'vitest';

import { pageAnalysisSchema } from './page-analysis';

describe('pageAnalysisSchema', () => {
  it('KPS §3のサンプルJSONを受理する', () => {
    const sample = {
      markdown: '## 3.2 リスク対応戦略\n本文...',
      page_type: 'content',
      sections: [{ level: 2, title: '3.2 リスク対応戦略' }],
      figures: [
        {
          id: 'fig-1',
          caption: '図3-2 リスクマトリクス',
          description: '発生確率と影響度の2軸で...',
        },
      ],
      tables: [{ id: 'tbl-1', caption: '表3-1', markdown: '| a | b |\n|---|---|\n| 1 | 2 |' }],
      formulas: [{ latex: 'EV = \\sum p_i x_i', explanation: '期待値の定義' }],
      concepts: [
        {
          name: 'EVM',
          name_ja: 'アーンドバリューマネジメント',
          definition: 'このページでの定義・説明の要約',
          importance: 0.8,
        },
      ],
      context_summary: '3.2節ではリスク対応の4戦略を説明した。',
    };

    const parsed = pageAnalysisSchema.parse(sample);
    expect(parsed.page_type).toBe('content');
    expect(parsed.concepts[0]?.name).toBe('EVM');
  });

  it('省略可能なフィールドはdefaultで補完される', () => {
    const parsed = pageAnalysisSchema.parse({ markdown: '', page_type: 'blank' });
    expect(parsed.sections).toEqual([]);
    expect(parsed.figures).toEqual([]);
    expect(parsed.tables).toEqual([]);
    expect(parsed.formulas).toEqual([]);
    expect(parsed.concepts).toEqual([]);
    expect(parsed.context_summary).toBe('');
  });

  it('importanceは0..1の範囲外を拒否する', () => {
    const bad = {
      markdown: 'x',
      page_type: 'content',
      concepts: [{ name: 'X', definition: '', importance: 1.5 }],
    };
    expect(pageAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it('未知のpage_typeを拒否する', () => {
    expect(pageAnalysisSchema.safeParse({ markdown: '', page_type: 'appendix' }).success).toBe(
      false,
    );
  });
});
