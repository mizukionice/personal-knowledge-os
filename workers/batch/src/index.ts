import {
  ClaudeLlmClient,
  ClaudePageAnalyzer,
  ClaudeVlmClient,
  LlmConceptExtractor,
  LlmRelationExtractor,
  MupdfDocumentParser,
  SectionChunker,
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
  const analyzer = new ClaudePageAnalyzer(
    new ClaudeVlmClient({ apiKey: anthropicApiKey, model: process.env.VLM_MODEL }),
  );

  const embedder = new WorkersAiEmbedder({
    accountId: requireEnv('CF_ACCOUNT_ID'),
    apiToken: requireEnv('CF_AI_TOKEN'),
  });
  const llm = new ClaudeLlmClient({ apiKey: anthropicApiKey, model: process.env.LLM_MODEL });

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
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
