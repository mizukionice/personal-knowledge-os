import type { ImageMediaType } from '../interfaces';

/**
 * VLM呼び出しの最小インターフェース。
 * PageAnalyzerのロジック（プロンプト・検証・修復リトライ）をプロバイダ非依存に保ち、
 * KPSの差し替え可能性（Claude → Gemini / セルフホスト等）を実現する。
 */

export interface VlmRequest {
  system: string;
  image: { data: Uint8Array; mediaType: ImageMediaType };
  /** 会話履歴。修復リトライでは [解析依頼, 前回出力, 修復依頼] になる */
  turns: VlmTurn[];
}

export interface VlmTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface VlmClient {
  /** 画像+テキストを送り、テキスト応答を返す */
  complete(request: VlmRequest): Promise<string>;
}
