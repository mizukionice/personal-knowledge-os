import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IMAGE_MAX_BYTES } from '@pkos/shared';

import { createApp } from '../app';
import { fakeDb } from '../test-support';
import { presignPutUrl } from '../r2-presign';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = `${USER_ID}/${DOC_ID}/`;

const docRow = {
  id: DOC_ID,
  user_id: USER_ID,
  status: 'created',
  r2_prefix: PREFIX,
};

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  GITHUB_DISPATCH_TOKEN: 'dummy',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  CF_ACCOUNT_ID: 'acct',
  R2_BUCKET: 'bucket',
};

const dbHolder: { client: ReturnType<typeof fakeDb> } = { client: fakeDb({}) };

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

vi.mock('../r2-presign', () => ({
  presignPutUrl: vi.fn(async (_env: unknown, key: string) => `https://signed.example/${key}`),
}));

function fakeR2(headSizeByKey: Record<string, number>) {
  return {
    head: vi.fn(async (key: string) =>
      key in headSizeByKey ? { size: headSizeByKey[key] } : null,
    ),
  };
}

async function post(path: string, body: unknown, env: Record<string, unknown> = baseEnv) {
  const token = await sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
  const app = createApp();
  return app.request(
    path,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbHolder.client = fakeDb({});
});

describe('POST /v1/documents/:id/upload-url', () => {
  it('画像はページ番号付きキーと署名URLを返す', async () => {
    dbHolder.client = fakeDb({ documents: { data: docRow, error: null } });

    const res = await post(`/v1/documents/${DOC_ID}/upload-url`, {
      file_name: 'IMG_0001.jpg',
      content_type: 'image/jpeg',
      page_number: 1,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; r2_key: string };
    expect(body.r2_key).toBe(`${PREFIX}uploads/0001.jpg`);
    expect(body.upload_url).toBe(`https://signed.example/${PREFIX}uploads/0001.jpg`);
    expect(presignPutUrl).toHaveBeenCalledOnce();
  });

  it('PDFはoriginal.pdf固定キー', async () => {
    dbHolder.client = fakeDb({ documents: { data: docRow, error: null } });

    const res = await post(`/v1/documents/${DOC_ID}/upload-url`, {
      file_name: 'book.pdf',
      content_type: 'application/pdf',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { r2_key: string };
    expect(body.r2_key).toBe(`${PREFIX}uploads/original.pdf`);
  });

  it('画像でpage_numberが無ければ422', async () => {
    dbHolder.client = fakeDb({ documents: { data: docRow, error: null } });
    const res = await post(`/v1/documents/${DOC_ID}/upload-url`, {
      file_name: 'a.jpg',
      content_type: 'image/jpeg',
    });
    expect(res.status).toBe(422);
  });

  it('許可外のcontent_typeは422', async () => {
    const res = await post(`/v1/documents/${DOC_ID}/upload-url`, {
      file_name: 'a.gif',
      content_type: 'image/gif',
    });
    expect(res.status).toBe(422);
  });

  it('存在しないdocumentは404', async () => {
    dbHolder.client = fakeDb({ documents: { data: null, error: null } });
    const res = await post(`/v1/documents/${DOC_ID}/upload-url`, {
      file_name: 'a.jpg',
      content_type: 'image/jpeg',
      page_number: 1,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/documents/:id/uploads/complete', () => {
  const key1 = `${PREFIX}uploads/0001.jpg`;
  const key2 = `${PREFIX}uploads/0002.jpg`;

  it('検証を通った画像キーからpages行を作りdocumentを更新する', async () => {
    const updated = { id: DOC_ID, status: 'uploading', page_count: 2 };
    dbHolder.client = fakeDb({
      documents: [
        { data: docRow, error: null },
        { data: updated, error: null },
      ],
      pages: { data: null, error: null },
    });
    const r2 = fakeR2({ [key1]: 1024, [key2]: 2048 });

    const res = await post(
      `/v1/documents/${DOC_ID}/uploads/complete`,
      { r2_keys: [key1, key2] },
      { ...baseEnv, R2: r2 },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { page_count: number } };
    expect(body.document.page_count).toBe(2);
    expect(r2.head).toHaveBeenCalledTimes(2);
    expect(dbHolder.client.from).toHaveBeenCalledWith('pages');
  });

  it('PDF1件ならpages行は作らない', async () => {
    const pdfKey = `${PREFIX}uploads/original.pdf`;
    dbHolder.client = fakeDb({
      documents: [
        { data: docRow, error: null },
        { data: { id: DOC_ID, status: 'uploading', page_count: null }, error: null },
      ],
      // pagesへのアクセスがあればfakeDbがthrowしてテストが落ちる
    });
    const r2 = fakeR2({ [pdfKey]: 1024 * 1024 });

    const res = await post(
      `/v1/documents/${DOC_ID}/uploads/complete`,
      { r2_keys: [pdfKey] },
      { ...baseEnv, R2: r2 },
    );

    expect(res.status).toBe(200);
  });

  it('プレフィックス外のキーは422', async () => {
    dbHolder.client = fakeDb({ documents: { data: docRow, error: null } });
    const res = await post(
      `/v1/documents/${DOC_ID}/uploads/complete`,
      { r2_keys: ['someone-else/doc/uploads/0001.jpg'] },
      { ...baseEnv, R2: fakeR2({}) },
    );
    expect(res.status).toBe(422);
  });

  it('未アップロードのキーは422', async () => {
    dbHolder.client = fakeDb({ documents: { data: docRow, error: null } });
    const res = await post(
      `/v1/documents/${DOC_ID}/uploads/complete`,
      { r2_keys: [key1] },
      { ...baseEnv, R2: fakeR2({}) },
    );
    expect(res.status).toBe(422);
  });

  it('画像サイズ上限超過は422', async () => {
    dbHolder.client = fakeDb({ documents: { data: docRow, error: null } });
    const r2 = fakeR2({ [key1]: IMAGE_MAX_BYTES + 1 });
    const res = await post(
      `/v1/documents/${DOC_ID}/uploads/complete`,
      { r2_keys: [key1] },
      { ...baseEnv, R2: r2 },
    );
    expect(res.status).toBe(422);
  });
});
