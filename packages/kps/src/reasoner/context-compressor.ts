import type { RetrievedChunk } from '../interfaces';

/**
 * トークン数の概算（KPS §9のコンテキスト予算用）。
 * 正確なトークナイザは使わず、日本語≈1文字1トークン・ASCII≈4文字1トークンの
 * 保守的なヒューリスティックで見積もる。
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(other + ascii / 4);
}

/**
 * Context Compression（KPS §9）: 関連度順（入力順）にチャンクを採用し、
 * 合計budgetトークン以内に絞る。先頭チャンク単体で超過する場合は切り詰める。
 */
export function compressContext(chunks: RetrievedChunk[], budget: number): RetrievedChunk[] {
  const result: RetrievedChunk[] = [];
  let used = 0;

  for (const chunk of chunks) {
    const cost = estimateTokens(chunk.content);
    if (used + cost <= budget) {
      result.push(chunk);
      used += cost;
      continue;
    }
    // 1件も採用できていない場合のみ、予算内に切り詰めて採用する
    if (result.length === 0) {
      let content = chunk.content;
      while (content.length > 0 && estimateTokens(content) > budget) {
        content = content.slice(0, Math.max(1, Math.floor(content.length * 0.8)));
        if (content.length === 1 && estimateTokens(content) > budget) break;
      }
      result.push({ ...chunk, content });
    }
    break;
  }
  return result;
}
