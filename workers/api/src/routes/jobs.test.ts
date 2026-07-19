import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createApp } from '../app';
import { fakeDb, type FakeResult } from '../test-support';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  GITHUB_DISPATCH_TOKEN: 'ghp_test',
  GITHUB_REPO: 'owner/repo',
};

const dbHolder: { client: ReturnType<typeof fakeDb> } = { client: fakeDb({}) };

vi.mock('../db', () => ({
  dbClient: () => dbHolder.client as unknown as SupabaseClient,
}));

const dispatchFetch = vi.fn();

async function request(path: string, init: RequestInit = {}) {
  const token = await sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
  const app = createApp();
  return app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } },
    baseEnv,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbHolder.client = fakeDb({});
  vi.stubGlobal('fetch', dispatchFetch);
  dispatchFetch.mockResolvedValue({ ok: true, status: 204, text: async () => '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const jobRow = { id: JOB_ID, document_id: DOC_ID, status: 'queued', progress: 0 };

describe('POST /v1/documents/:id/process', () => {
  it('jobを作成しrepository_dispatchを送って202を返す', async () => {
    dbHolder.client = fakeDb({
      documents: { data: { id: DOC_ID, user_id: USER_ID }, error: null },
      jobs: { data: jobRow, error: null },
    });

    const res = await request(`/v1/documents/${DOC_ID}/process`, { method: 'POST' });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { job: { id: string } };
    expect(body.job.id).toBe(JOB_ID);

    expect(dispatchFetch).toHaveBeenCalledOnce();
    const [url, init] = dispatchFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/owner/repo/dispatches');
    const payload = JSON.parse(init.body as string) as {
      event_type: string;
      client_payload: { job_id: string };
    };
    expect(payload.event_type).toBe('process_job');
    expect(payload.client_payload.job_id).toBe(JOB_ID);
  });

  it('アクティブjobがある場合は422を返す', async () => {
    dbHolder.client = fakeDb({
      documents: { data: { id: DOC_ID, user_id: USER_ID }, error: null },
      jobs: { data: null, error: { message: 'duplicate key', code: '23505' } } as FakeResult,
    });

    const res = await request(`/v1/documents/${DOC_ID}/process`, { method: 'POST' });
    expect(res.status).toBe(422);
    expect(dispatchFetch).not.toHaveBeenCalled();
  });

  it('documentが無ければ404', async () => {
    dbHolder.client = fakeDb({ documents: { data: null, error: null } });
    const res = await request(`/v1/documents/${DOC_ID}/process`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('dispatch失敗時はjobをfailedにして500を返す', async () => {
    dispatchFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' });
    dbHolder.client = fakeDb({
      documents: { data: { id: DOC_ID, user_id: USER_ID }, error: null },
      jobs: [
        { data: jobRow, error: null },
        { data: null, error: null }, // failedへの更新
      ],
    });

    const res = await request(`/v1/documents/${DOC_ID}/process`, { method: 'POST' });
    expect(res.status).toBe(500);
    // insert + failed更新の2回jobsテーブルに触る
    expect(dbHolder.client.from).toHaveBeenCalledWith('jobs');
  });
});

describe('GET /v1/jobs', () => {
  it('一覧を返す', async () => {
    dbHolder.client = fakeDb({ jobs: { data: [jobRow], error: null } });
    const res = await request(`/v1/jobs?document_id=${DOC_ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [jobRow] });
  });

  it('不正なdocument_idは422', async () => {
    const res = await request('/v1/jobs?document_id=not-a-uuid');
    expect(res.status).toBe(422);
  });
});

describe('GET /v1/jobs/:id', () => {
  it('進捗を返す', async () => {
    dbHolder.client = fakeDb({ jobs: { data: { ...jobRow, progress: 40 }, error: null } });
    const res = await request(`/v1/jobs/${JOB_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { progress: number } };
    expect(body.job.progress).toBe(40);
  });

  it('存在しなければ404', async () => {
    dbHolder.client = fakeDb({ jobs: { data: null, error: null } });
    const res = await request(`/v1/jobs/${JOB_ID}`);
    expect(res.status).toBe(404);
  });
});
