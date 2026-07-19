import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { PagesSummary } from '@pkos/shared';

import { App } from '@/App';
import { contentApi, documentsApi, jobsApi } from '@/lib/api';
import type { DocumentWithSummary } from '@/lib/api';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth },
}));

vi.mock('@/lib/api', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  documentsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() },
  uploadsApi: { getUploadUrl: vi.fn(), complete: vi.fn() },
  jobsApi: { process: vi.fn(), list: vi.fn() },
  contentApi: { markdown: vi.fn() },
}));

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session;
const DOC_ID = '22222222-2222-4222-8222-222222222222';

function summary(overrides: Partial<PagesSummary> = {}): PagesSummary {
  return { total: 3, pending: 0, processing: 0, completed: 3, failed: 0, ...overrides };
}

function doc(overrides: Partial<DocumentWithSummary> = {}): DocumentWithSummary {
  return {
    id: DOC_ID,
    user_id: 'user-1',
    title: 'リスクマネジメント概論',
    author: null,
    doc_type: 'book',
    status: 'completed',
    page_count: 3,
    r2_prefix: `user-1/${DOC_ID}/`,
    created_at: '2026-07-19T00:00:00Z',
    updated_at: '2026-07-19T00:00:00Z',
    pages_summary: summary(),
    ...overrides,
  };
}

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={[`/documents/${DOC_ID}`]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  vi.mocked(jobsApi.list).mockResolvedValue({ jobs: [] });
});

afterEach(cleanup);

describe('DocumentViewerPage', () => {
  it('完了した書籍のMarkdownと目次を表示する', async () => {
    vi.mocked(documentsApi.get).mockResolvedValue({ document: doc() });
    vi.mocked(contentApi.markdown).mockResolvedValue({
      markdown: '# 第1章 序論\n\n本文です。\n\n## 1.1 背景\n\n背景の説明。',
    });

    renderViewer();

    expect(await screen.findByRole('heading', { name: 'リスクマネジメント概論' })).toBeDefined();
    expect(await screen.findByRole('heading', { name: '第1章 序論' })).toBeDefined();
    expect(screen.getByText('本文です。')).toBeDefined();

    const tocNav = screen.getByRole('navigation', { name: '目次' });
    expect(tocNav.textContent).toContain('第1章 序論');
    expect(tocNav.textContent).toContain('1.1 背景');
  });

  it('危険なHTMLはsanitizeされる', async () => {
    vi.mocked(documentsApi.get).mockResolvedValue({ document: doc() });
    vi.mocked(contentApi.markdown).mockResolvedValue({
      markdown: '# 見出し\n\n<script>window.hacked = true;</script><img src=x onerror="x()">本文',
    });

    renderViewer();
    await screen.findByRole('heading', { name: '見出し' });

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img[onerror]')).toBeNull();
  });

  it('処理中は進捗を表示しMarkdownは取得しない', async () => {
    vi.mocked(documentsApi.get).mockResolvedValue({
      document: doc({
        status: 'processing',
        pages_summary: summary({ completed: 1, pending: 2, failed: 0 }),
      }),
    });
    vi.mocked(jobsApi.list).mockResolvedValue({
      jobs: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          user_id: 'user-1',
          document_id: DOC_ID,
          job_type: 'process_document',
          status: 'processing',
          progress: 33,
          error: null,
          started_at: null,
          finished_at: null,
          created_at: '2026-07-19T00:00:00Z',
        },
      ],
    });

    renderViewer();

    expect(await screen.findByText(/処理中… 1 \/ 3 ページ完了/)).toBeDefined();
    expect(contentApi.markdown).not.toHaveBeenCalled();
  });

  it('失敗ページがあれば再実行ボタンでprocessを呼ぶ', async () => {
    vi.mocked(documentsApi.get).mockResolvedValue({
      document: doc({
        status: 'failed',
        pages_summary: summary({ completed: 2, failed: 1 }),
      }),
    });
    vi.mocked(contentApi.markdown).mockResolvedValue({ markdown: '# 部分的な本文' });
    vi.mocked(jobsApi.process).mockResolvedValue({
      job: {
        id: '44444444-4444-4444-8444-444444444444',
        user_id: 'user-1',
        document_id: DOC_ID,
        job_type: 'process_document',
        status: 'queued',
        progress: 0,
        error: null,
        started_at: null,
        finished_at: null,
        created_at: '2026-07-19T00:00:00Z',
      },
    });

    renderViewer();

    expect(await screen.findByText(/1ページの処理に失敗しました/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '失敗ページを再実行' }));
    await waitFor(() => expect(jobsApi.process).toHaveBeenCalledWith(DOC_ID));
  });
});
