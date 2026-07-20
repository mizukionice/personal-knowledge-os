import { seed } from './support/seed';

/** E2E全体の前処理: テストユーザー作成 + 完成済み書籍のシード */
export default async function globalSetup(): Promise<void> {
  const { documentId } = await seed();
  process.env.E2E_SEEDED_DOC_ID = documentId;
}
