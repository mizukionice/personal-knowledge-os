import { z } from 'zod';

import type { LlmClient } from './llm-client';

export class LlmJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmJsonParseError';
  }
}

function tryParse<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: string } {
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fenced?.[1]) {
    text = fenced[1];
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `schema validation failed: ${z.prettifyError(parsed.error)}` };
  }
  return { ok: true, data: parsed.data };
}

/**
 * LLMにJSONを出力させ、zodで検証する。パース失敗時は1回だけ修復リトライする
 * （PageAnalyzerと同じ方針。KPS §3）。
 */
export async function completeJson<T>(
  client: LlmClient,
  schema: z.ZodType<T>,
  system: string,
  user: string,
): Promise<T> {
  const raw = await client.complete({ system, user });
  const first = tryParse(raw, schema);
  if (first.ok) return first.data;

  const repaired = await client.complete({
    system,
    user: `${user}\n\n----\n先ほどの出力はJSONとして不正でした。\nエラー: ${first.error}\n先ほどの出力:\n${raw}\n\nスキーマに厳密に従った有効なJSONのみを出力し直してください。`,
  });
  const second = tryParse(repaired, schema);
  if (second.ok) return second.data;
  throw new LlmJsonParseError(`failed to parse LLM output after repair retry: ${second.error}`);
}
