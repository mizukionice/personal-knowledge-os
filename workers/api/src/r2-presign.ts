import { AwsClient } from 'aws4fetch';

import type { Env } from './types';

export const UPLOAD_URL_EXPIRES_SECONDS = 15 * 60; // TDD §6: 署名付きURLは15分有効

/** R2のS3互換APIに対する署名付きPUT URLを発行する（aws4fetch / SigV4 query署名） */
export async function presignPutUrl(env: Env, key: string): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `https://${env.R2_BUCKET}.${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`,
  );
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_EXPIRES_SECONDS));

  const signed = await client.sign(new Request(url, { method: 'PUT' }), {
    aws: { signQuery: true, service: 's3', region: 'auto' },
  });
  return signed.url;
}
