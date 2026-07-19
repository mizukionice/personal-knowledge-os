import { describe, expect, it, vi } from 'vitest';
import type { PageAnalysis } from '@pkos/shared';
import type { DocumentParser, PageAnalyzer, PageAnalyzerInput } from '@pkos/kps';

import { runJob } from './job-runner';
import type { Db, DocumentRow, JobRow, ObjectStore, PageRow } from './types';

const USER = 'user-1';
const DOC = 'doc-1';
const JOB = 'job-1';

function analysis(overrides: Partial<PageAnalysis> = {}): PageAnalysis {
  return {
    markdown: '# ページ本文',
    page_type: 'content',
    sections: [],
    figures: [],
    tables: [],
    formulas: [],
    concepts: [],
    context_summary: '要約',
    ...overrides,
  };
}

/** インメモリのDbフェイク */
function fakeDb(options: { job?: JobRow | null; document: DocumentRow; pages: PageRow[] }) {
  const state = {
    job:
      options.job === undefined
        ? ({ id: JOB, user_id: USER, document_id: DOC, status: 'queued', progress: 0 } as JobRow)
        : options.job,
    document: { ...options.document },
    pages: options.pages.map((p) => ({ ...p })),
    jobPatches: [] as Record<string, unknown>[],
    docPatches: [] as Record<string, unknown>[],
  };

  const db: Db = {
    claimJob: vi.fn(async (jobId: string) => {
      if (!state.job || state.job.id !== jobId || state.job.status !== 'queued') return null;
      state.job = { ...state.job, status: 'processing' };
      return state.job;
    }),
    getDocument: vi.fn(async () => state.document),
    listPages: vi.fn(async () => [...state.pages].sort((a, b) => a.page_number - b.page_number)),
    upsertPages: vi.fn(async (rows) => {
      for (const row of rows) {
        state.pages.push({
          id: `page-${row.page_number}`,
          status: 'pending',
          page_type: null,
          r2_markdown_key: null,
          r2_analysis_key: null,
          error: null,
          ...row,
        });
      }
    }),
    updatePage: vi.fn(async (pageId, patch) => {
      const page = state.pages.find((p) => p.id === pageId);
      if (page) Object.assign(page, patch);
    }),
    updateJob: vi.fn(async (_jobId, patch) => {
      state.jobPatches.push(patch as Record<string, unknown>);
      if (state.job) Object.assign(state.job, patch);
    }),
    updateDocument: vi.fn(async (_docId, patch) => {
      state.docPatches.push(patch as Record<string, unknown>);
      Object.assign(state.document, patch);
    }),
  };
  return { db, state };
}

function fakeStore(objects: Record<string, Uint8Array | string> = {}) {
  const data = new Map<string, Uint8Array>(
    Object.entries(objects).map(([k, v]) => [
      k,
      typeof v === 'string' ? new TextEncoder().encode(v) : v,
    ]),
  );
  const store: ObjectStore = {
    get: vi.fn(async (key: string) => {
      const value = data.get(key);
      if (!value) throw new Error(`object not found: ${key}`);
      return value;
    }),
    put: vi.fn(async (key: string, body: Uint8Array | string) => {
      data.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body);
    }),
  };
  return { store, data };
}

function page(pageNumber: number, overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: `page-${pageNumber}`,
    user_id: USER,
    document_id: DOC,
    page_number: pageNumber,
    status: 'pending',
    page_type: null,
    r2_image_key: `${USER}/${DOC}/uploads/${String(pageNumber).padStart(4, '0')}.jpg`,
    r2_markdown_key: null,
    r2_analysis_key: null,
    error: null,
    ...overrides,
  };
}

function bookDocument(): DocumentRow {
  return {
    id: DOC,
    user_id: USER,
    title: 'テスト書籍',
    doc_type: 'book',
    status: 'uploading',
    page_count: 2,
    r2_prefix: `${USER}/${DOC}/`,
  };
}

const noopParser: DocumentParser = { parse: vi.fn(async () => []) };

describe('runJob', () => {
  it('写真2ページを順に処理し、R2/DBを更新してjobを完了する', async () => {
    const { db, state } = fakeDb({ document: bookDocument(), pages: [page(1), page(2)] });
    const { store, data } = fakeStore({
      [`${USER}/${DOC}/uploads/0001.jpg`]: 'img1',
      [`${USER}/${DOC}/uploads/0002.jpg`]: 'img2',
    });
    const inputs: PageAnalyzerInput[] = [];
    const analyzer: PageAnalyzer = {
      analyze: vi.fn(async (input) => {
        inputs.push(input);
        return analysis({
          markdown: `# p${input.pageNumber}`,
          context_summary: `p${input.pageNumber}の要約`,
        });
      }),
    };

    await runJob({ db, store, parser: noopParser, analyzer }, JOB);

    expect(state.job?.status).toBe('completed');
    expect(state.job?.progress).toBe(100);
    expect(state.document.status).toBe('completed');
    expect(state.pages.every((p) => p.status === 'completed')).toBe(true);
    expect(state.pages[0]?.r2_markdown_key).toBe(`${USER}/${DOC}/markdown/0001.md`);
    expect(state.pages[0]?.r2_analysis_key).toBe(`${USER}/${DOC}/analysis/0001.json`);

    // context_summaryの連鎖（KPS §3）
    expect(inputs[0]?.previousContextSummary).toBeUndefined();
    expect(inputs[1]?.previousContextSummary).toBe('p1の要約');

    // full.md結合
    const fullMd = new TextDecoder().decode(data.get(`${USER}/${DOC}/markdown/full.md`));
    expect(fullMd).toBe('# p1\n\n# p2');
  });

  it('ページ失敗時はそのページをfailedにし、残りは処理し、jobをfailedにする', async () => {
    const { db, state } = fakeDb({ document: bookDocument(), pages: [page(1), page(2)] });
    const { store } = fakeStore({
      [`${USER}/${DOC}/uploads/0001.jpg`]: 'img1',
      [`${USER}/${DOC}/uploads/0002.jpg`]: 'img2',
    });
    const analyzer: PageAnalyzer = {
      analyze: vi.fn(async (input) => {
        if (input.pageNumber === 1) throw new Error('VLM error');
        return analysis();
      }),
    };

    await runJob({ db, store, parser: noopParser, analyzer }, JOB);

    expect(state.pages[0]?.status).toBe('failed');
    expect(state.pages[0]?.error).toContain('VLM error');
    expect(state.pages[1]?.status).toBe('completed');
    expect(state.job?.status).toBe('failed');
    expect(state.job?.error).toBe('1 page(s) failed');
    expect(state.document.status).toBe('failed');
  });

  it('PDFはページ分解してpages行を作成しpage_countを更新する', async () => {
    const { db, state } = fakeDb({
      document: { ...bookDocument(), doc_type: 'pdf', page_count: null },
      pages: [],
    });
    const { store, data } = fakeStore({
      [`${USER}/${DOC}/uploads/original.pdf`]: 'pdf-bytes',
    });
    const parser: DocumentParser = {
      parse: vi.fn(async () => [
        { pageNumber: 1, data: new Uint8Array([1]) },
        { pageNumber: 2, data: new Uint8Array([2]) },
      ]),
    };
    const analyzer: PageAnalyzer = { analyze: vi.fn(async () => analysis()) };

    await runJob({ db, store, parser, analyzer }, JOB);

    expect(parser.parse).toHaveBeenCalledOnce();
    expect(data.has(`${USER}/${DOC}/pages/0001.png`)).toBe(true);
    expect(data.has(`${USER}/${DOC}/pages/0002.png`)).toBe(true);
    expect(state.pages).toHaveLength(2);
    expect(state.document.page_count).toBe(2);
    expect(state.job?.status).toBe('completed');
  });

  it('再実行では完了済みページをスキップし、失敗ページのみ処理する', async () => {
    const completedPage = page(1, {
      status: 'completed',
      r2_markdown_key: `${USER}/${DOC}/markdown/0001.md`,
      r2_analysis_key: `${USER}/${DOC}/analysis/0001.json`,
    });
    const { db, state } = fakeDb({
      document: bookDocument(),
      pages: [completedPage, page(2, { status: 'failed', error: 'previous error' })],
    });
    const { store } = fakeStore({
      [`${USER}/${DOC}/uploads/0002.jpg`]: 'img2',
      [`${USER}/${DOC}/markdown/0001.md`]: '# p1',
      [`${USER}/${DOC}/analysis/0001.json`]: JSON.stringify(
        analysis({ context_summary: 'p1の要約(R2から)' }),
      ),
    });
    const inputs: PageAnalyzerInput[] = [];
    const analyzer: PageAnalyzer = {
      analyze: vi.fn(async (input) => {
        inputs.push(input);
        return analysis();
      }),
    };

    await runJob({ db, store, parser: noopParser, analyzer }, JOB);

    expect(analyzer.analyze).toHaveBeenCalledOnce();
    // 直前の完了ページの要約をR2の分析JSONから復元して渡す
    expect(inputs[0]?.previousContextSummary).toBe('p1の要約(R2から)');
    expect(state.job?.status).toBe('completed');
  });

  it('queuedでないjobは何もせず終了する（多重起動対策）', async () => {
    const { db } = fakeDb({
      job: { id: JOB, user_id: USER, document_id: DOC, status: 'processing', progress: 50 },
      document: bookDocument(),
      pages: [page(1)],
    });
    const { store } = fakeStore();
    const analyzer: PageAnalyzer = { analyze: vi.fn() };

    await runJob({ db, store, parser: noopParser, analyzer }, JOB);

    expect(db.getDocument).not.toHaveBeenCalled();
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('pagesが無い場合はjobをfailedにしてthrowする', async () => {
    const { db, state } = fakeDb({ document: bookDocument(), pages: [] });
    const { store } = fakeStore();
    const analyzer: PageAnalyzer = { analyze: vi.fn() };

    await expect(runJob({ db, store, parser: noopParser, analyzer }, JOB)).rejects.toThrow(
      'no pages to process',
    );
    expect(state.job?.status).toBe('failed');
    expect(state.document.status).toBe('failed');
  });
});
