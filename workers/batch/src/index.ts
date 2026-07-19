import { ClaudePageAnalyzer, ClaudeVlmClient, MupdfDocumentParser } from '@pkos/kps';

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
  const analyzer = new ClaudePageAnalyzer(
    new ClaudeVlmClient({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      model: process.env.VLM_MODEL,
    }),
  );

  await runJob({ db, store, parser: new MupdfDocumentParser(), analyzer, log: console.log }, jobId);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
