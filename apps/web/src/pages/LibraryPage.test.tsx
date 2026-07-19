import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { Document } from '@pkos/shared';

import { App } from '@/App';
import { documentsApi } from '@/lib/api';

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
  documentsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
  uploadsApi: { getUploadUrl: vi.fn(), complete: vi.fn() },
  jobsApi: { process: vi.fn(), list: vi.fn() },
  searchApi: { search: vi.fn() },
  conceptsApi: { list: vi.fn(), get: vi.fn(), forDocument: vi.fn() },
  contentApi: { markdown: vi.fn() },
}));

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session;

const doc = (overrides: Partial<Document>): Document => ({
  id: '22222222-2222-4222-8222-222222222222',
  user_id: 'user-1',
  title: 'タイトル',
  author: null,
  doc_type: 'book',
  status: 'created',
  page_count: null,
  r2_prefix: 'user-1/doc-1/',
  created_at: '2026-07-19T00:00:00Z',
  updated_at: '2026-07-19T00:00:00Z',
  ...overrides,
});

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={['/']}>
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
});

afterEach(cleanup);

describe('LibraryPage', () => {
  it('書籍一覧をカード表示する', async () => {
    vi.mocked(documentsApi.list).mockResolvedValue({
      documents: [
        doc({ title: 'リスクマネジメント概論', status: 'completed', page_count: 120 }),
        doc({ id: '33333333-3333-4333-8333-333333333333', title: '確率論入門' }),
      ],
      total: 2,
    });

    renderLibrary();

    expect(await screen.findByText('リスクマネジメント概論')).toBeDefined();
    expect(screen.getByText('確率論入門')).toBeDefined();
    expect(screen.getByText('完了')).toBeDefined();
    expect(screen.getByText('120ページ')).toBeDefined();
  });

  it('空の場合は使い方ガイドを表示する', async () => {
    vi.mocked(documentsApi.list).mockResolvedValue({ documents: [], total: 0 });
    renderLibrary();
    expect(await screen.findByText('まだ書籍がありません')).toBeDefined();
  });

  it('読み込み失敗時にエラーを表示する', async () => {
    vi.mocked(documentsApi.list).mockRejectedValue(new Error('network down'));
    renderLibrary();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('network down');
  });

  it('確認ダイアログでOKすると削除APIを呼ぶ', async () => {
    vi.mocked(documentsApi.list).mockResolvedValue({
      documents: [doc({ title: '消す本' })],
      total: 1,
    });
    vi.mocked(documentsApi.remove).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: '消す本を削除' }));

    await waitFor(() =>
      expect(documentsApi.remove).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'),
    );
  });

  it('確認ダイアログでキャンセルすると削除しない', async () => {
    vi.mocked(documentsApi.list).mockResolvedValue({
      documents: [doc({ title: '残す本' })],
      total: 1,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: '残す本を削除' }));

    expect(documentsApi.remove).not.toHaveBeenCalled();
  });
});
