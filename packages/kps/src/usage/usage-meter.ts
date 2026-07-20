/** Claude APIのトークン使用量（1回の呼び出し分） */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** $/1M tokens 単位の価格表 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

/** claude-opus-4-8 の価格（2026-07時点、$/1M tokens） */
export const OPUS_4_8_PRICING: ModelPricing = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 6.25,
};

/**
 * 複数のClaude API呼び出しのトークン使用量を集計する（M5-03 コスト計測）。
 * VlmClient / LlmClient にコールバックで注入し、ステージ横断で合算する。
 */
export class UsageMeter {
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheCreation = 0;
  private calls = 0;

  record(usage: TokenUsage): void {
    this.input += usage.inputTokens;
    this.output += usage.outputTokens;
    this.cacheRead += usage.cacheReadTokens;
    this.cacheCreation += usage.cacheCreationTokens;
    this.calls += 1;
  }

  get callCount(): number {
    return this.calls;
  }

  total(): TokenUsage {
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      cacheReadTokens: this.cacheRead,
      cacheCreationTokens: this.cacheCreation,
    };
  }

  /** 価格表からUSDコストを見積もる */
  estimateCostUsd(pricing: ModelPricing): number {
    return (
      (this.input * pricing.inputPerMTok +
        this.output * pricing.outputPerMTok +
        this.cacheRead * pricing.cacheReadPerMTok +
        this.cacheCreation * pricing.cacheWritePerMTok) /
      1_000_000
    );
  }

  /** ログ用の1行サマリ */
  summary(pricing: ModelPricing = OPUS_4_8_PRICING): string {
    const t = this.total();
    const cost = this.estimateCostUsd(pricing);
    return `calls=${this.calls} in=${t.inputTokens} out=${t.outputTokens} cacheRead=${t.cacheReadTokens} cacheWrite=${t.cacheCreationTokens} estCost=$${cost.toFixed(4)}`;
  }
}

/** Anthropic SDKのusageオブジェクトをTokenUsageに正規化する */
export function toTokenUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
