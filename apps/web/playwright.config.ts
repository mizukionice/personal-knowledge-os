import { defineConfig, devices } from '@playwright/test';

import { WEB_BASE_URL } from './e2e/support/env';

/**
 * E2E設定（M5-01）。実Supabase/R2/Workers AIに対して動かすため、
 * webサーバー（vite :5173）とAPIワーカー（wrangler dev :8787）が起動している前提。
 * `pnpm --filter @pkos/web e2e` で実行する。
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
