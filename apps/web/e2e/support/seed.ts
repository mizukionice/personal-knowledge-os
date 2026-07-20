import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';

import { env, SEED_DOC, TEST_USER } from './env';

/** service roleクライアント（RLSをバイパスしてシード/クリーンアップする） */
function admin(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function r2Put(key: string, body: string, contentType: string): Promise<void> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  const url = `https://${env.R2_BUCKET}.${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
  const res = await client.fetch(url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
    aws: { service: 's3', region: 'auto' },
  });
  if (!res.ok) {
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text()}`);
  }
}

async function r2DeletePrefix(prefix: string): Promise<void> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  const base = `https://${env.R2_BUCKET}.${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const listRes = await client.fetch(`${base}/?list-type=2&prefix=${encodeURIComponent(prefix)}`, {
    method: 'GET',
    aws: { service: 's3', region: 'auto' },
  });
  if (!listRes.ok) return;
  const xml = await listRes.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
  for (const key of keys) {
    await client.fetch(`${base}/${key}`, {
      method: 'DELETE',
      aws: { service: 's3', region: 'auto' },
    });
  }
}

export interface SeededData {
  userId: string;
  documentId: string;
}

/**
 * E2E用のテストユーザーを作成し、閲覧・検索できる完成済み書籍を1冊シードする。
 * 既に残っていれば一度クリーンアップしてから作り直す（再実行に強くする）。
 */
export async function seed(): Promise<SeededData> {
  const db = admin();
  await teardown();

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`failed to create test user: ${createErr?.message}`);
  }
  const userId = created.user.id;

  const documentId = crypto.randomUUID();
  const r2Prefix = `${userId}/${documentId}/`;
  const { error: docErr } = await db.from('documents').insert({
    id: documentId,
    user_id: userId,
    title: SEED_DOC.title,
    author: 'E2E',
    doc_type: 'book',
    status: 'completed',
    page_count: 1,
    r2_prefix: r2Prefix,
  });
  if (docErr) throw new Error(`failed to seed document: ${docErr.message}`);

  const { error: chunkErr } = await db.from('chunks').insert([
    {
      user_id: userId,
      document_id: documentId,
      chunk_type: 'text',
      content: SEED_DOC.markdown,
      section_path: '第1章 概要',
      page_start: 1,
      page_end: 1,
    },
  ]);
  if (chunkErr) throw new Error(`failed to seed chunk: ${chunkErr.message}`);

  await r2Put(`${r2Prefix}markdown/full.md`, SEED_DOC.markdown, 'text/markdown');

  return { userId, documentId };
}

/** テストユーザーと関連データ（documents cascade + R2オブジェクト）を削除する */
export async function teardown(): Promise<void> {
  const db = admin();
  const { data: list } = await db.auth.admin.listUsers();
  const user = list?.users.find((u) => u.email === TEST_USER.email);
  if (!user) return;

  const { data: docs } = await db.from('documents').select('r2_prefix').eq('user_id', user.id);
  for (const doc of docs ?? []) {
    if (doc.r2_prefix) await r2DeletePrefix(doc.r2_prefix as string);
  }
  // documents/chunks等は user 削除では自動cascadeしないため明示削除
  await db.from('documents').delete().eq('user_id', user.id);
  await db.auth.admin.deleteUser(user.id);
}
