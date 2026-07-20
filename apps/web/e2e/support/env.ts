import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** リポジトリルートの .env を読む（vite の envDir と同じ場所） */
function loadEnv(): Record<string, string> {
  const text = readFileSync(path.join(repoRoot, '.env'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  return out;
}

export const env = loadEnv();

export const WEB_BASE_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

/** E2E専用テストユーザー（global-setupで作成、teardownで削除） */
export const TEST_USER = {
  email: 'e2e-pkos@example.com',
  password: 'e2e-Test-Password-123',
};

/** シードする書籍のタイトルと検索でヒットするキーワード */
export const SEED_DOC = {
  title: 'E2Eテスト蔵書',
  keyword: 'ズンドコベロンチョ',
  markdown:
    '# E2Eテスト蔵書\n\n## 第1章 概要\n\nこれはE2Eテスト用のシード文書です。ズンドコベロンチョという固有名詞を含みます。\n',
};
