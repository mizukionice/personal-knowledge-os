import { teardown } from './support/seed';

/** E2E全体の後処理: テストユーザーと関連データを削除 */
export default async function globalTeardown(): Promise<void> {
  await teardown();
}
