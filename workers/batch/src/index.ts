import {
  ClaudeLlmClient,
  ClaudePageAnalyzer,
  ClaudeVlmClient,
  LlmConceptExtractor,
  LlmRelationExtractor,
  MupdfDocumentParser,
  OPUS_4_8_PRICING,
  SectionChunker,
  UsageMeter,
  WorkersAiEmbedder,
} from '@pkos/kps';

import { SupabaseDb } from './db';
import { runJob } from './job-runner';
import { R2Store } from './r2';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`required environment variable ${name} is not set`);
  }
  return value;
}

async function main(): Promise<void> {
  const jobId = requireEnv('JOB_ID');

  const db = new SupabaseDb(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const store = new R2Store({
    accountId: requireEnv('CF_ACCOUNT_ID'),
    bucket: requireEnv('R2_BUCKET'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  });
  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  // M5-03: VLM（ページ解析）とLLM（概念/関係抽出）のトークン使用量を別々に集計する
  const vlmMeter = new UsageMeter();
  const llmMeter = new UsageMeter();
  const analyzer = new ClaudePageAnalyzer(
    new ClaudeVlmClient({
      apiKey: anthropicApiKey,
      model: process.env.VLM_MODEL,
      onUsage: (u) => vlmMeter.record(u),
    }),
  );

  const embedder = new WorkersAiEmbedder({
    accountId: requireEnv('CF_ACCOUNT_ID'),
    apiToken: requireEnv('CF_AI_TOKEN'),
  });
  const llm = new ClaudeLlmClient({
    apiKey: anthropicApiKey,
    model: process.env.LLM_MODEL,
    onUsage: (u) => llmMeter.record(u),
  });

  await runJob(
    {
      db,
      store,
      parser: new MupdfDocumentParser(),
      analyzer,
      knowledge: {
        chunker: new SectionChunker(),
        embedder,
        conceptExtractor: new LlmConceptExtractor(llm, embedder),
        relationExtractor: new LlmRelationExtractor(llm),
      },
      log: console.log,
    },
    jobId,
  );

  // M5-03: コスト集計（Actionsログに出力）。VLMとLLMを分けて記録し合算コストを出す
  const totalCost =
    vlmMeter.estimateCostUsd(OPUS_4_8_PRICING) + llmMeter.estimateCostUsd(OPUS_4_8_PRICING);
  console.log(`[cost] VLM   ${vlmMeter.summary()}`);
  console.log(`[cost] LLM   ${llmMeter.summary()}`);
  console.log(
    `[cost] TOTAL Anthropic estCost=$${totalCost.toFixed(4)}（embedding=Workers AI別計上）`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
