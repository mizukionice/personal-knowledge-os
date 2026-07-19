import { AwsClient } from 'aws4fetch';

import type { ObjectStore } from './types';

export interface R2StoreOptions {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** R2のS3互換APIをaws4fetchの署名付きリクエストで直接叩くObjectStore実装 */
export class R2Store implements ObjectStore {
  private readonly client: AwsClient;
  private readonly baseUrl: string;

  constructor(options: R2StoreOptions) {
    this.client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
    this.baseUrl = `https://${options.bucket}.${options.accountId}.r2.cloudflarestorage.com`;
  }

  private async request(key: string, init: RequestInit): Promise<Response> {
    const response = await this.client.fetch(`${this.baseUrl}/${key}`, {
      ...init,
      aws: { service: 's3', region: 'auto' },
    } as RequestInit);
    if (!response.ok) {
      throw new Error(`R2 ${init.method ?? 'GET'} ${key} failed with status ${response.status}`);
    }
    return response;
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.request(key, { method: 'GET' });
    return new Uint8Array(await response.arrayBuffer());
  }

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.request(key, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': contentType },
    });
  }
}
