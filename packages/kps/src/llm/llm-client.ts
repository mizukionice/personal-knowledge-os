/**
 * テキストLLM呼び出しの最小インターフェース（画像なし）。
 * ConceptExtractor / RelationExtractor / Reasoner が使用し、
 * プロバイダ差し替え（KPS §2）を可能にする。
 */

export interface LlmRequest {
  system: string;
  user: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}
