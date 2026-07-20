import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { App } from '@/App';
import { chatApi, type ChatStreamResult } from '@/lib/api';

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
  chatApi: { stream: vi.fn() },
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

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <App />
    </MemoryRouter>,
  );
}

async function submitQuestion(text: string) {
  const input = await screen.findByLabelText('質問');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /送信/ }));
}

describe('ChatPage', () => {
  it('質問を送るとストリーミング回答とcitationリンクを表示する', async () => {
    vi.mocked(chatApi.stream).mockImplementation(async (_message, _history, onDelta) => {
      onDelta('犍陀多は蜘蛛を助けた');
      onDelta('[蜘蛛の糸 p.1 §一]。');
      return {
        citations: [{ document_id: 'doc-kumo', title: '蜘蛛の糸', page: 1, section_path: '一' }],
        used_general_knowledge: false,
      } satisfies ChatStreamResult;
    });

    renderChat();
    await submitQuestion('犍陀多は何をした？');

    // ユーザー発言が表示される
    expect(await screen.findByText('犍陀多は何をした？')).toBeTruthy();

    // 回答が確定し、citationがViewerへのリンクになる
    const link = await screen.findByRole('link', { name: '[蜘蛛の糸 p.1 §一]' });
    expect(link.getAttribute('href')).toBe('/documents/doc-kumo');

    // 履歴なしの初回呼び出し
    expect(chatApi.stream).toHaveBeenCalledWith('犍陀多は何をした？', [], expect.any(Function));
  });

  it('蔵書外の回答には一般知識バッジを表示する', async () => {
    vi.mocked(chatApi.stream).mockImplementation(async (_m, _h, onDelta) => {
      onDelta('あなたのライブラリにはこの情報がありません。');
      return { citations: [], used_general_knowledge: true };
    });

    renderChat();
    await submitQuestion('フランス革命は？');

    expect(await screen.findByText('ライブラリ外の一般知識')).toBeTruthy();
  });

  it('2問目は1問目のやり取りをhistoryとして送る', async () => {
    vi.mocked(chatApi.stream).mockImplementation(async (_m, _h, onDelta) => {
      onDelta('回答A');
      return { citations: [], used_general_knowledge: false };
    });

    renderChat();
    await submitQuestion('質問1');
    await screen.findByText('回答A');

    await submitQuestion('質問2');
    await waitFor(() => {
      expect(chatApi.stream).toHaveBeenLastCalledWith(
        '質問2',
        [
          { role: 'user', content: '質問1' },
          { role: 'assistant', content: '回答A' },
        ],
        expect.any(Function),
      );
    });
  });

  it('ストリームエラー時はエラーメッセージを表示する', async () => {
    vi.mocked(chatApi.stream).mockRejectedValue(new Error('boom'));

    renderChat();
    await submitQuestion('質問');

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
