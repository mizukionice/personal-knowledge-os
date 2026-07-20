import { describe, expect, it, vi } from 'vitest';

import type { PageAnalyzerInput } from '../interfaces';
import { ClaudePageAnalyzer, PageAnalysisParseError } from './claude-page-analyzer';
import { PAGE_ANALYZER_SYSTEM_PROMPT_V1 } from '../prompts/page-analyzer.v1';
import type { VlmRequest } from './vlm-client';

const VALID_OUTPUT = JSON.stringify({
  markdown: '## 3.2 リスク対応戦略\n本文...',
  page_type: 'content',
  sections: [{ level: 2, title: '3.2 リスク対応戦略' }],
  concepts: [
    { name: 'EVM', name_ja: 'アーンドバリュー', definition: '進捗管理手法', importance: 0.8 },
  ],
  context_summary: '3.2節の続き。',
});

function makeInput(overrides: Partial<PageAnalyzerInput> = {}): PageAnalyzerInput {
  return {
    image: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
    pageNumber: 12,
    ...overrides,
  };
}

function mockVlm(...responses: string[]) {
  const complete = vi.fn<(req: VlmRequest) => Promise<string>>();
  for (const response of responses) {
    complete.mockResolvedValueOnce(response);
  }
  return { complete };
}

describe('ClaudePageAnalyzer', () => {
  it('maxBytes超過の画像は縮小されてからVLMに渡る', async () => {
    // 実画像が必要なため、mupdfでPNGを生成する（image-preprocessor.test.tsと同方式）
    const mupdf = await import('mupdf');
    const pdf = new TextEncoder().encode(
      `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
    );
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    const png = doc
      .loadPage(0)
      .toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, false)
      .asPNG();

    const vlm = mockVlm(VALID_OUTPUT);
    const analyzer = new ClaudePageAnalyzer(vlm, { maxBytes: png.length - 1 });

    await analyzer.analyze(makeInput({ image: { data: png, mediaType: 'image/png' } }));

    const request = vlm.complete.mock.calls[0]![0];
    expect(request.image.mediaType).toBe('image/jpeg');
    expect(request.image.data.length).toBeLessThan(png.length);
  });

  it('有効なJSON出力をPageAnalysisとして返す', async () => {
    const vlm = mockVlm(VALID_OUTPUT);
    const analyzer = new ClaudePageAnalyzer(vlm);

    const result = await analyzer.analyze(makeInput());

    expect(result.page_type).toBe('content');
    expect(result.concepts[0]?.name).toBe('EVM');
    expect(vlm.complete).toHaveBeenCalledOnce();

    const request = vlm.complete.mock.calls[0]![0];
    expect(request.system).toBe(PAGE_ANALYZER_SYSTEM_PROMPT_V1);
    expect(request.image.mediaType).toBe('image/png');
    expect(request.turns[0]?.text).toContain('ページ番号: 12');
  });

  it('前ページの文脈要約をプロンプトに含める', async () => {
    const vlm = mockVlm(VALID_OUTPUT);
    const analyzer = new ClaudePageAnalyzer(vlm);

    await analyzer.analyze(makeInput({ previousContextSummary: '第3章はリスク管理の概要。' }));

    const request = vlm.complete.mock.calls[0]![0];
    expect(request.turns[0]?.text).toContain('第3章はリスク管理の概要。');
  });

  it('コードフェンス付きのJSON出力も受理する', async () => {
    const vlm = mockVlm('```json\n' + VALID_OUTPUT + '\n```');
    const analyzer = new ClaudePageAnalyzer(vlm);

    const result = await analyzer.analyze(makeInput());
    expect(result.page_type).toBe('content');
    expect(vlm.complete).toHaveBeenCalledOnce();
  });

  it('パース失敗時は1回だけ修復リトライする', async () => {
    const vlm = mockVlm('これはJSONではありません', VALID_OUTPUT);
    const analyzer = new ClaudePageAnalyzer(vlm);

    const result = await analyzer.analyze(makeInput());

    expect(result.page_type).toBe('content');
    expect(vlm.complete).toHaveBeenCalledTimes(2);

    // 修復リトライは [解析依頼, 前回出力, 修復依頼] の3ターン
    const repairRequest = vlm.complete.mock.calls[1]![0];
    expect(repairRequest.turns).toHaveLength(3);
    expect(repairRequest.turns[1]).toEqual({ role: 'assistant', text: 'これはJSONではありません' });
    expect(repairRequest.turns[2]?.text).toContain('有効なJSON');
  });

  it('スキーマ違反（importance範囲外）も修復リトライの対象', async () => {
    const invalid = JSON.stringify({
      markdown: 'x',
      page_type: 'content',
      concepts: [{ name: 'X', definition: '', importance: 5 }],
    });
    const vlm = mockVlm(invalid, VALID_OUTPUT);
    const analyzer = new ClaudePageAnalyzer(vlm);

    const result = await analyzer.analyze(makeInput());
    expect(result.concepts[0]?.name).toBe('EVM');
    expect(vlm.complete).toHaveBeenCalledTimes(2);
  });

  it('修復後も不正ならPageAnalysisParseErrorを投げる（リトライは1回のみ）', async () => {
    const vlm = mockVlm('broken', 'still broken');
    const analyzer = new ClaudePageAnalyzer(vlm);

    await expect(analyzer.analyze(makeInput())).rejects.toThrow(PageAnalysisParseError);
    expect(vlm.complete).toHaveBeenCalledTimes(2);
  });
});
