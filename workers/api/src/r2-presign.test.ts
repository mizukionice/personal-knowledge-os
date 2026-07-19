import { describe, expect, it } from 'vitest';

import { presignPutUrl, UPLOAD_URL_EXPIRES_SECONDS } from './r2-presign';
import type { Env } from './types';

const env = {
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  CF_ACCOUNT_ID: 'acct123',
  R2_BUCKET: 'pkos',
} as Env;

describe('presignPutUrl', () => {
  it('R2のS3エンドポイントに対するSigV4 query署名付きURLを返す', async () => {
    const url = new URL(await presignPutUrl(env, 'user/doc/uploads/0001.jpg'));

    expect(url.hostname).toBe('pkos.acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/user/doc/uploads/0001.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_EXPIRES_SECONDS));
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain('test-access-key');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
  });
});
