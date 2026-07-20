import { pageAnalysisSchema, type PageAnalysis } from '@pkos/shared';
import { z } from 'zod';

import type { PageAnalyzer, PageAnalyzerInput } from '../interfaces';
import {
  buildPageAnalyzerUserText,
  buildRepairUserText,
  PAGE_ANALYZER_SYSTEM_PROMPT_V1,
} from '../prompts/page-analyzer.v1';
import { prepareImageForVlm, type PrepareImageOptions } from './image-preprocessor';
import type { VlmClient } from './vlm-client';

export class PageAnalysisParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageAnalysisParseError';
  }
}

type ParseResult = { success: true; data: PageAnalysis } | { success: false; error: string };

/** VLM出力からJSONを取り出して検証する。コードフェンス付き出力にも耐える */
function parseAnalysis(raw: string): ParseResult {
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fenced?.[1]) {
    text = fenced[1];
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { success: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = pageAnalysisSchema.safeParse(json);
  if (!parsed.success) {
    return { success: false, error: `schema validation failed: ${z.prettifyError(parsed.error)}` };
  }
  return { success: true, data: parsed.data };
}

/**
 * PageAnalyzer実装（KPS §3）。
 * プロンプト組立・JSON検証・修復リトライ（1回だけ）を担い、
 * VLM呼び出し自体は注入されたVlmClientに委譲する。
 */
export class ClaudePageAnalyzer implements PageAnalyzer {
  constructor(
    private readonly vlm: VlmClient,
    private readonly imageOptions: PrepareImageOptions = {},
  ) {}

  async analyze(input: PageAnalyzerInput): Promise<PageAnalysis> {
    // Claude APIのbase64 10MB制限を超える写真を縮小する（修復リトライでも同じ画像を使う）
    const image = prepareImageForVlm(input.image, this.imageOptions);
    const userText = buildPageAnalyzerUserText(input.pageNumber, input.previousContextSummary);
    const raw = await this.vlm.complete({
      system: PAGE_ANALYZER_SYSTEM_PROMPT_V1,
      image,
      turns: [{ role: 'user', text: userText }],
    });

    const first = parseAnalysis(raw);
    if (first.success) {
      return first.data;
    }

    // パース失敗時は1回だけ修復リトライ（KPS §3）
    const repaired = await this.vlm.complete({
      system: PAGE_ANALYZER_SYSTEM_PROMPT_V1,
      image,
      turns: [
        { role: 'user', text: userText },
        { role: 'assistant', text: raw },
        { role: 'user', text: buildRepairUserText(raw, first.error) },
      ],
    });

    const second = parseAnalysis(repaired);
    if (second.success) {
      return second.data;
    }
    throw new PageAnalysisParseError(
      `page ${input.pageNumber}: failed to parse VLM output after repair retry: ${second.error}`,
    );
  }
}
