import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { App } from '@/App';
import { ApiRequestError, documentsApi, jobsApi, uploadsApi } from '@/lib/api';

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
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public retryAfterSeconds?: number,
    ) {
      super(message);
    }
  },
  documentsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
  uploadsApi: {
    getUploadUrl: vi.fn(),
    complete: vi.fn(),
  },
  jobsApi: {
    process: vi.fn(),
    list: vi.fn(),
  },
  searchApi: { search: vi.fn() },
  conceptsApi: { list: vi.fn(), get: vi.fn(), forDocument: vi.fn() },
  contentApi: {
    markdown: vi.fn(),
  },
}));

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session;
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const putFetch = vi.fn();

function imageFile(name: string) {
  return new File(['x'], name, { type: 'image/jpeg' });
}

function renderUpload() {
  return render(
    <MemoryRouter initialEntries={['/upload']}>
      <App />
    </MemoryRouter>,
  );
}

async function fillAndSelect(files: File[]) {
  fireEvent.change(await screen.findByLabelText('書籍タイトル（必須）'), {
    target: { value: 'テスト書籍' },
  });
  fireEvent.change(screen.getByLabelText('ファイルを選択'), { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', putFetch);
  auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  vi.mocked(documentsApi.list).mockResolvedValue({ documents: [], total: 0 });
  vi.mocked(documentsApi.create).mockResolvedValue({
    document: { id: DOC_ID } as never,
  });
  vi.mocked(uploadsApi.getUploadUrl).mockImplementation(async (_id, input) => ({
    upload_url: `https://signed.example/${input.page_number ?? 'pdf'}`,
    r2_key: `user-1/${DOC_ID}/uploads/${String(input.page_number ?? 0).padStart(4, '0')}.jpg`,
  }));
  vi.mocked(uploadsApi.complete).mockResolvedValue({ document: { id: DOC_ID } as never });
  vi.mocked(jobsApi.process).mockResolvedValue({ job: { id: 'job-1' } as never });
  vi.mocked(jobsApi.list).mockResolvedValue({ jobs: [] });
  // 遷移先のViewerが描画できる最小のdocument
  vi.mocked(documentsApi.get).mockResolvedValue({
    document: {
      id: DOC_ID,
      title: 'テスト書籍',
      status: 'processing',
      author: null,
      pages_summary: { total: 2, pending: 2, processing: 0, completed: 0, failed: 0 },
    } as never,
  });
  putFetch.mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('UploadPage', () => {
  it('タイトル未入力またはファイルなしでは開始できない', async () => {
    renderUpload();
    const button = await screen.findByRole('button', { name: 'アップロード開始' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('写真2枚: create→ページ順にupload-url→PUT→completeの順で呼ぶ', async () => {
    renderUpload();
    await fillAndSelect([imageFile('a.jpg'), imageFile('b.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    await waitFor(() => expect(uploadsApi.complete).toHaveBeenCalledOnce());

    expect(documentsApi.create).toHaveBeenCalledWith({ title: 'テスト書籍', doc_type: 'book' });
    expect(uploadsApi.getUploadUrl).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ file_name: 'a.jpg', page_number: 1 }),
    );
    expect(uploadsApi.getUploadUrl).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ file_name: 'b.jpg', page_number: 2 }),
    );
    expect(putFetch).toHaveBeenCalledTimes(2);
    expect(uploadsApi.complete).toHaveBeenCalledWith(DOC_ID, [
      `user-1/${DOC_ID}/uploads/0001.jpg`,
      `user-1/${DOC_ID}/uploads/0002.jpg`,
    ]);
    // 完了後は処理を開始してViewer（進捗表示）へ遷移
    expect(jobsApi.process).toHaveBeenCalledWith(DOC_ID);
    expect(await screen.findByRole('heading', { name: 'テスト書籍' })).toBeDefined();
  });

  it('並び替えでページ順が入れ替わる', async () => {
    renderUpload();
    await fillAndSelect([imageFile('a.jpg'), imageFile('b.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'b.jpgを上へ' }));
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    await waitFor(() => expect(uploadsApi.complete).toHaveBeenCalledOnce());
    expect(uploadsApi.getUploadUrl).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ file_name: 'b.jpg', page_number: 1 }),
    );
    expect(uploadsApi.getUploadUrl).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ file_name: 'a.jpg', page_number: 2 }),
    );
  });

  it('PDFはpage_numberなしでdoc_type=pdfになる', async () => {
    renderUpload();
    await fillAndSelect([new File(['x'], 'book.pdf', { type: 'application/pdf' })]);
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    await waitFor(() => expect(uploadsApi.complete).toHaveBeenCalledOnce());
    expect(documentsApi.create).toHaveBeenCalledWith({ title: 'テスト書籍', doc_type: 'pdf' });
    const input = vi.mocked(uploadsApi.getUploadUrl).mock.calls[0]?.[1];
    expect(input?.page_number).toBeUndefined();
  });

  it('PUT失敗時はcompleteせず、再試行で失敗分だけ再実行する', async () => {
    // 403は自動リトライ対象外なので1回で失敗が確定する
    putFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValue({ ok: true, status: 200 });

    renderUpload();
    await fillAndSelect([imageFile('a.jpg'), imageFile('b.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1件のアップロードに失敗');
    expect(uploadsApi.complete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '失敗分を再試行' }));
    await waitFor(() => expect(uploadsApi.complete).toHaveBeenCalledOnce());

    // documentは再作成しない。PUTは初回2回+再試行1回
    expect(documentsApi.create).toHaveBeenCalledOnce();
    expect(putFetch).toHaveBeenCalledTimes(3);
    expect(uploadsApi.complete).toHaveBeenCalledWith(DOC_ID, [
      `user-1/${DOC_ID}/uploads/0001.jpg`,
      `user-1/${DOC_ID}/uploads/0002.jpg`,
    ]);
  });

  it('一時的なPUT失敗（5xx）は指数バックオフで自動リトライして完了する', async () => {
    putFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 200 });

    renderUpload();
    await fillAndSelect([imageFile('a.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    await waitFor(() => expect(uploadsApi.complete).toHaveBeenCalledOnce(), { timeout: 4000 });
    // 1回目失敗 + 自動リトライ1回
    expect(putFetch).toHaveBeenCalledTimes(2);
    expect(jobsApi.process).toHaveBeenCalledWith(DOC_ID);
  }, 10000);

  it('429はRetry-Afterの秒数だけ待って自動再開する（試行回数を消費しない）', async () => {
    const rateLimited = new ApiRequestError('rate_limited', 'too many requests', 429, 1);
    vi.mocked(uploadsApi.getUploadUrl)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValue({
        upload_url: 'https://signed.example/1',
        r2_key: `user-1/${DOC_ID}/uploads/0001.jpg`,
      });

    renderUpload();
    await fillAndSelect([imageFile('a.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    await waitFor(() => expect(uploadsApi.complete).toHaveBeenCalledOnce(), { timeout: 5000 });
    // 429で1回待機 → 再発行して成功
    expect(uploadsApi.getUploadUrl).toHaveBeenCalledTimes(2);
    expect(putFetch).toHaveBeenCalledTimes(1);
  }, 10000);

  it('全リトライ失敗時は失敗理由をエラーメッセージに表示する', async () => {
    // CORS/ネットワーク遮断時にブラウザが投げるTypeErrorを再現
    putFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    renderUpload();
    await fillAndSelect([imageFile('a.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'アップロード開始' }));

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toContain('1件のアップロードに失敗');
    expect(alert.textContent).toContain('Failed to fetch');
    // 最大3回試行して打ち切る
    expect(putFetch).toHaveBeenCalledTimes(3);
    expect(uploadsApi.complete).not.toHaveBeenCalled();
  }, 10000);

  it('対応外の形式はエラー表示して追加しない', async () => {
    renderUpload();
    await fillAndSelect([new File(['x'], 'a.gif', { type: 'image/gif' })]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('a.gif');
    expect(screen.getByRole('button', { name: 'アップロード開始' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
