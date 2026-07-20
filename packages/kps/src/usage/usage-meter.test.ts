import { describe, expect, it } from 'vitest';

import { OPUS_4_8_PRICING, toTokenUsage, UsageMeter } from './usage-meter';

describe('UsageMeter', () => {
  it('複数呼び出しのトークンを合算する', () => {
    const meter = new UsageMeter();
    meter.record({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    meter.record({
      inputTokens: 200,
      outputTokens: 10,
      cacheReadTokens: 30,
      cacheCreationTokens: 5,
    });

    expect(meter.callCount).toBe(2);
    expect(meter.total()).toEqual({
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 30,
      cacheCreationTokens: 5,
    });
  });

  it('価格表からUSDコストを見積もる', () => {
    const meter = new UsageMeter();
    // 1M input, 1M output → $5 + $25 = $30
    meter.record({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(meter.estimateCostUsd(OPUS_4_8_PRICING)).toBeCloseTo(30, 5);
  });

  it('toTokenUsageはSDKのusageを正規化しnullを0にする', () => {
    expect(
      toTokenUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null }),
    ).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});
