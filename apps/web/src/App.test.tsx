import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { App } from '@/App';
import { documentsApi, jobsApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  documentsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() },
  uploadsApi: { getUploadUrl: vi.fn(), complete: vi.fn() },
  jobsApi: { process: vi.fn(), list: vi.fn() },
  contentApi: { markdown: vi.fn() },
}));

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

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});

afterEach(cleanup);

describe('認証ガード', () => {
  it('未ログインで保護ルートに入るとLoginへリダイレクトされる', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeDefined();
  });

  it('ログイン済みなら / でLibraryが表示される', async () => {
    auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeDefined();
  });

  it('ログイン済みで /login に入るとLibraryへリダイレクトされる', async () => {
    auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeDefined();
  });
});

describe('ログイン画面', () => {
  it('メール・パスワードでsignInWithPasswordを呼ぶ', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    renderAt('/login');

    fireEvent.change(await screen.findByLabelText('メールアドレス'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      }),
    );
  });

  it('認証エラーがrole=alertで表示される', async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    });
    renderAt('/login');

    fireEvent.change(await screen.findByLabelText('メールアドレス'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid login credentials');
  });

  it('サインアップでメール確認が必要な場合は案内を表示する', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    renderAt('/login');

    fireEvent.click(await screen.findByRole('button', { name: 'アカウントを作成する' }));
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('確認メール');
  });
});

describe('ルーティング（ログイン済み）', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
  });

  it('/upload でUploadが表示される', async () => {
    renderAt('/upload');
    expect(await screen.findByRole('heading', { name: 'Upload' })).toBeDefined();
  });

  it('/documents/:id でDocument Viewerが表示される', async () => {
    vi.mocked(jobsApi.list).mockResolvedValue({ jobs: [] });
    vi.mocked(documentsApi.get).mockResolvedValue({
      document: {
        id: 'abc-123',
        title: 'サンプル書籍',
        status: 'processing',
        author: null,
        pages_summary: { total: 1, pending: 1, processing: 0, completed: 0, failed: 0 },
      } as never,
    });
    renderAt('/documents/abc-123');
    expect(await screen.findByRole('heading', { name: 'サンプル書籍' })).toBeDefined();
  });

  it('/settings でアカウント情報とログアウトが表示される', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeDefined();
    expect(screen.getByText('test@example.com')).toBeDefined();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeDefined();
  });

  it('不明なパスでNotFoundが表示される', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { name: 'ページが見つかりません' })).toBeDefined();
  });
});
