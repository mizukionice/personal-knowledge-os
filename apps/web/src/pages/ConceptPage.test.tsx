import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { App } from '@/App';
import { conceptsApi } from '@/lib/api';

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

function renderConcept() {
  return render(
    <MemoryRouter initialEntries={['/concepts/concept-1']}>
      <App />
    </MemoryRouter>,
  );
}

describe('ConceptPage', () => {
  it('概念名・別名・出典別定義・関連概念を表示する', async () => {
    vi.mocked(conceptsApi.get).mockResolvedValue({
      concept: {
        id: 'concept-1',
        canonical_name: 'Earned Value Management',
        aliases: ['EVM', 'アーンドバリューマネジメント'],
        importance: 0.8,
      },
      definitions: [
        {
          definition: '出来高で進捗とコストを統合管理する手法。',
          document_id: 'doc-1',
          document_title: 'PM入門',
          page_start: 45,
          section_path: '第4章',
        },
      ],
      related: [
        {
          concept_id: 'concept-2',
          canonical_name: '進捗管理',
          relation: 'is_a',
          direction: 'outgoing',
        },
        {
          concept_id: 'concept-3',
          canonical_name: '完成時総コスト見積もり批判',
          relation: 'contradicts',
          direction: 'incoming',
        },
      ],
    });

    renderConcept();

    expect(await screen.findByRole('heading', { name: 'Earned Value Management' })).toBeDefined();
    expect(screen.getByText(/別名: EVM、アーンドバリューマネジメント/)).toBeDefined();
    expect(screen.getByText(/出来高で進捗とコストを統合管理する手法/)).toBeDefined();
    expect(screen.getByText(/PM入門 — p\.45/)).toBeDefined();

    // 関連概念リンク
    const relatedLink = screen.getByRole('link', { name: /進捗管理/ });
    expect(relatedLink.getAttribute('href')).toBe('/concepts/concept-2');

    // contradictsは強調表示（destructiveスタイル）+ アラート表示
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('矛盾する主張');
    const contradictsLink = screen.getByRole('link', { name: /完成時総コスト見積もり批判/ });
    expect(contradictsLink.className).toContain('destructive');
  });

  it('読み込み失敗時はエラーを表示する', async () => {
    vi.mocked(conceptsApi.get).mockRejectedValue(new Error('boom'));
    renderConcept();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('概念を読み込めませんでした');
  });
});
