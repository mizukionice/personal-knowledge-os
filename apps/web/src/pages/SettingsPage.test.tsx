import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { AdminUserRow, UserProfile } from '@pkos/shared';

import { App } from '@/App';
import { adminApi, profileApi } from '@/lib/api';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth, from: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  documentsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() },
  uploadsApi: { getUploadUrl: vi.fn(), complete: vi.fn() },
  jobsApi: { process: vi.fn(), list: vi.fn() },
  searchApi: { search: vi.fn() },
  conceptsApi: { list: vi.fn(), get: vi.fn(), forDocument: vi.fn() },
  contentApi: { markdown: vi.fn() },
  profileApi: { getOwn: vi.fn() },
  adminApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    listUsers: vi.fn(),
    updateUser: vi.fn(),
  },
}));

const fakeSession = { user: { id: 'admin-1', email: 'admin@example.com' } } as unknown as Session;

const adminProfile: UserProfile = {
  user_id: 'admin-1',
  role: 'admin',
  can_upload: true,
  can_process: true,
  can_chat: true,
};

const userRow: AdminUserRow = {
  user_id: 'user-2',
  email: 'member@example.com',
  role: 'user',
  can_upload: true,
  can_process: true,
  can_chat: false,
  created_at: '2026-07-01T00:00:00Z',
};

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
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

describe('SettingsPage 管理者パネル', () => {
  it('一般ユーザーには管理者パネルを表示しない', async () => {
    vi.mocked(profileApi.getOwn).mockResolvedValue({ ...adminProfile, role: 'user' });
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeDefined();
    await waitFor(() => expect(profileApi.getOwn).toHaveBeenCalled());
    expect(screen.queryByText('管理者')).toBeNull();
    expect(adminApi.getSettings).not.toHaveBeenCalled();
  });

  it('管理者にはsignup状態とユーザー一覧を表示する', async () => {
    vi.mocked(profileApi.getOwn).mockResolvedValue(adminProfile);
    vi.mocked(adminApi.getSettings).mockResolvedValue({
      settings: { signup_enabled: true, updated_at: '2026-07-23T00:00:00Z' },
    });
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [userRow] });

    renderSettings();

    expect(await screen.findByText('公開中（誰でも登録できます）')).toBeDefined();
    expect(screen.getByText('member@example.com')).toBeDefined();
    const chatCheckbox = screen.getByLabelText(
      'member@example.comのチャット',
    ) as HTMLInputElement;
    expect(chatCheckbox.checked).toBe(false);
  });

  it('登録停止ボタンでPUT /admin/settingsを呼び表示が切り替わる', async () => {
    vi.mocked(profileApi.getOwn).mockResolvedValue(adminProfile);
    vi.mocked(adminApi.getSettings).mockResolvedValue({
      settings: { signup_enabled: true, updated_at: '2026-07-23T00:00:00Z' },
    });
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [] });
    vi.mocked(adminApi.updateSettings).mockResolvedValue({
      settings: { signup_enabled: false, updated_at: '2026-07-23T00:01:00Z' },
    });

    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '登録を停止する' }));

    await waitFor(() => expect(adminApi.updateSettings).toHaveBeenCalledWith(false));
    expect(await screen.findByText('停止中（新規登録をブロックしています）')).toBeDefined();
  });

  it('権限チェックボックスでPATCH /admin/users/:idを呼ぶ', async () => {
    vi.mocked(profileApi.getOwn).mockResolvedValue(adminProfile);
    vi.mocked(adminApi.getSettings).mockResolvedValue({
      settings: { signup_enabled: true, updated_at: '2026-07-23T00:00:00Z' },
    });
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [userRow] });
    vi.mocked(adminApi.updateUser).mockResolvedValue({
      profile: { ...userRow, can_chat: true },
    });

    renderSettings();
    fireEvent.click(await screen.findByLabelText('member@example.comのチャット'));

    await waitFor(() =>
      expect(adminApi.updateUser).toHaveBeenCalledWith('user-2', { can_chat: true }),
    );
  });
});
