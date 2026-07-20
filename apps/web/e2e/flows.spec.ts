import { expect, test, type Page } from '@playwright/test';

import { SEED_DOC, TEST_USER } from './support/env';

/** ログインフォームを操作してLibraryまで遷移する */
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(TEST_USER.email);
  await page.locator('#password').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  // ログイン成功でLibrary（/）に遷移し、シード書籍が並ぶ
  await expect(page.getByText(SEED_DOC.title)).toBeVisible();
}

test.describe('E2E: ログイン→アップロード→閲覧→検索', () => {
  test('未認証だと /login にリダイレクトされる', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('ログインしてLibraryにシード書籍が表示される', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('link', { name: new RegExp(SEED_DOC.title) })).toBeVisible();
  });

  test('書籍を開くとViewerにタイトルとMarkdownが表示される', async ({ page }) => {
    await login(page);
    await page.getByText(SEED_DOC.title).click();
    await expect(page.getByRole('heading', { name: SEED_DOC.title, level: 1 })).toBeVisible();
    // R2から取得したMarkdown本文（見出し）が描画される
    await expect(page.getByRole('heading', { name: '第1章 概要' })).toBeVisible();
  });

  test('内容で検索するとヒットし、Viewerへ遷移できる', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Search' }).click();
    await page.getByLabel('検索キーワード').fill(SEED_DOC.keyword);
    await page.getByRole('button', { name: '検索' }).click();

    const result = page.getByText(SEED_DOC.keyword, { exact: false }).first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByRole('heading', { name: SEED_DOC.title, level: 1 })).toBeVisible();
  });

  test('新しい書籍をアップロードするとViewerに遷移し処理が始まる', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Upload' }).click();

    const uploadTitle = `E2Eアップロード ${Date.now()}`;
    await page.locator('#title').fill(uploadTitle);

    // 小さなPNGを添付する（1x1）
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await page.locator('input[type="file"]').setInputFiles({
      name: 'page-1.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64'),
    });

    await page.getByRole('button', { name: 'アップロード開始' }).click();

    // アップロード完了で新規書籍のViewerに遷移し、タイトルが表示される（07_UI_UX）
    await expect(page.getByRole('heading', { name: uploadTitle, level: 1 })).toBeVisible({
      timeout: 30_000,
    });
  });
});
