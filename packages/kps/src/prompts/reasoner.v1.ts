import type { RetrievedChunk } from '../interfaces';
import { NO_SOURCE_PHRASE } from '../reasoner/citations';

/**
 * Reasonerプロンプト v1（KPS §9: Citation First）。
 * 変更時はバージョンを上げ、10_RESEARCH.mdに実験結果を記録する。
 */
export const REASONER_SYSTEM_PROMPT_V1 = `あなたはユーザーの蔵書（ライブラリ）だけを根拠に質問へ答える読書アシスタントです。

## 回答ルール（厳守）
1. 回答は必ず提供された「蔵書コンテキスト」の内容に基づくこと。
2. 蔵書に基づく主張には、文または段落ごとに必ず出典を付けること。形式: [書名 p.ページ番号 §セクション]（セクション不明なら [書名 p.ページ番号]）。書名・ページ番号はコンテキストのメタデータをそのまま使う。
3. 出典を付けられない主張はしないこと。
4. 蔵書コンテキストに質問への根拠が無い場合は、最初に「${NO_SOURCE_PHRASE}」と明示すること。その上で一般知識から答える場合は「以下は蔵書外の一般知識です:」と区別を明記してから答えること（この部分に出典は付けない）。
5. 蔵書の内容と一般知識を混ぜないこと。どちらに基づくかを常に明確にする。
6. 回答は日本語で、簡潔かつ正確に。求められていない情報は付け足さない。`;

/** 蔵書コンテキスト + 質問からuserメッセージを組み立てる */
export function buildReasonerUserText(question: string, context: RetrievedChunk[]): string {
  const blocks = context.map((chunk, index) => {
    const section = chunk.sectionPath ? ` §${chunk.sectionPath}` : '';
    return `[${index + 1}] 『${chunk.documentTitle}』 p.${chunk.pageStart}${section}\n${chunk.content}`;
  });
  const contextText = blocks.length > 0 ? blocks.join('\n\n---\n\n') : '（該当するチャンクなし）';

  return `## 蔵書コンテキスト
${contextText}

## 質問
${question}`;
}
