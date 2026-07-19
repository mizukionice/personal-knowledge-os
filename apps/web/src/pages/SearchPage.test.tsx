import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { App } from '@/App';
import { searchApi } from '@/lib/api';

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
  searchApi: { search: vi.fn() },
  conceptsApi: { list: vi.fn(), get: vi.fn(), forDocument: vi.fn() },
  contentApi: { markdown: vi.fn() },
}));

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session;

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});

afterEach(cleanup);

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={['/search']}>
      <App />
    </MemoryRouter>,
  );
}

describe('SearchPage', () => {
  it('検索を実行し、citation付きの結果カードを表示する', async () => {
    vi.mocked(searchApi.search).mockResolvedValue({
      results: [
        {
          chunk_id: 'chunk-1',
          content: 'リスク対応には回避・転嫁・軽減・受容の4戦略がある。',
          chunk_type: 'text',
          document_id: 'doc-1',
          document_title: 'リスクマネジメント概論',
          page_start: 45,
          page_end: 46,
          section_path: '第3章 > 3.2 リスク対応',
          score: 0.03,
        },
      ],
    });

    renderSearch();
    fireEvent.change(await screen.findByLabelText('検索キーワード'), {
      target: { value: 'リスク対応' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText(/回避・転嫁・軽減・受容/)).toBeDefined();
    expect(screen.getByText(/リスクマネジメント概論 — p\.45/)).toBeDefined();
    expect(searchApi.search).toHaveBeenCalledWith('リスク対応');

    // 結果カードはViewerへのリンク
    const link = screen.getByRole('link', { name: /回避・転嫁・軽減・受容/ });
    expect(link.getAttribute('href')).toBe('/documents/doc-1');
  });

  it('結果が無い場合はその旨を表示する', async () => {
    vi.mocked(searchApi.search).mockResolvedValue({ results: [] });

    renderSearch();
    fireEvent.change(await screen.findByLabelText('検索キーワード'), {
      target: { value: '存在しない内容' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText(/一致する内容は見つかりませんでした/)).toBeDefined();
  });
});
