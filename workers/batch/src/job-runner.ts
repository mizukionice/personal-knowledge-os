import {
  pageAnalysisSchema,
  r2FullMarkdownKey,
  r2PageAnalysisKey,
  r2PageImageKey,
  r2PageMarkdownKey,
  r2UploadPdfKey,
  type PageAnalysis,
} from '@pkos/shared';
import type { AnalyzedPage, DocumentParser, ImageMediaType, PageAnalyzer } from '@pkos/kps';

import { runKnowledgeStage, type KnowledgeDeps } from './knowledge-stage';
import type { Db, ObjectStore } from './types';

export interface RunnerDeps {
  db: Db;
  store: ObjectStore;
  parser: DocumentParser;
  analyzer: PageAnalyzer;
  /** M3 Knowledge化ステージ（未指定ならスキップ = M2までの動作） */
  knowledge?: Omit<KnowledgeDeps, 'db'>;
  log?: (message: string) => void;
}

function mediaTypeFromKey(key: string): ImageMediaType {
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/**
 * ジョブランナー（TDD §4）: job claim → (PDFならページ分解) → ページ順次処理 →
 * R2/DB保存 → 進捗更新 → (全ページ成功ならKnowledge化) → job/document完了更新。
 *
 * ページ処理は逐次実行する。KPS §3のcontext_summary連鎖（前ページの要約を
 * 次ページの入力に渡す）が逐次依存を作るため、KPS優先の判断でTDD §5の
 * 並列度設定より正確性を取る。VLMのリトライはVlmClient側が担う。
 */
export async function runJob(deps: RunnerDeps, jobId: string): Promise<void> {
  const { db, store, parser, analyzer } = deps;
  const log = deps.log ?? (() => {});

  const job = await db.claimJob(jobId);
  if (!job) {
    log(`job ${jobId} is not queued (already claimed or missing) — nothing to do`);
    return;
  }
  log(`claimed job ${job.id} for document ${job.document_id}`);

  try {
    const document = await db.getDocument(job.document_id);
    await db.updateDocument(document.id, { status: 'processing' });

    // PDFでpages未作成なら、原本をページ画像に分解してpages行を作る
    let pages = await db.listPages(document.id);
    if (pages.length === 0 && document.doc_type === 'pdf') {
      log('splitting PDF into page images');
      const pdf = await store.get(r2UploadPdfKey(document.user_id, document.id));
      const images = await parser.parse(pdf);
      for (const image of images) {
        const key = r2PageImageKey(document.user_id, document.id, image.pageNumber);
        await store.put(key, image.data, 'image/png');
      }
      await db.upsertPages(
        images.map((image) => ({
          user_id: document.user_id,
          document_id: document.id,
          page_number: image.pageNumber,
          r2_image_key: r2PageImageKey(document.user_id, document.id, image.pageNumber),
        })),
      );
      await db.updateDocument(document.id, { page_count: images.length });
      pages = await db.listPages(document.id);
    }

    if (pages.length === 0) {
      throw new Error('no pages to process (upload may not be completed)');
    }

    const loadAnalysis = async (key: string): Promise<PageAnalysis | undefined> => {
      try {
        const raw = new TextDecoder().decode(await store.get(key));
        const parsed = pageAnalysisSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    };

    const total = pages.length;
    let completed = pages.filter((page) => page.status === 'completed').length;
    let failed = 0;
    /** ページ番号→PageAnalysis（今回処理した分。過去分は後でR2から復元） */
    const analyses = new Map<number, PageAnalysis>();
    /** 直前ページのcontext_summary（KPS §3）。再実行時は完了済み分析から遅延取得する */
    let previousSummary: string | undefined;
    let previousCompletedKey: string | null = null;

    for (const page of pages) {
      if (page.status === 'completed') {
        previousCompletedKey = page.r2_analysis_key;
        previousSummary = undefined; // 必要になったら遅延取得
        continue;
      }

      // 再実行で途中から始まる場合、直前の完了ページの要約をR2から復元する
      if (previousSummary === undefined && previousCompletedKey) {
        previousSummary = (await loadAnalysis(previousCompletedKey))?.context_summary || undefined;
      }

      log(`processing page ${page.page_number}/${total}`);
      await db.updatePage(page.id, { status: 'processing', error: null });
      try {
        const imageData = await store.get(page.r2_image_key);
        const analysis: PageAnalysis = await analyzer.analyze({
          image: { data: imageData, mediaType: mediaTypeFromKey(page.r2_image_key) },
          pageNumber: page.page_number,
          previousContextSummary: previousSummary,
        });

        const analysisKey = r2PageAnalysisKey(document.user_id, document.id, page.page_number);
        const markdownKey = r2PageMarkdownKey(document.user_id, document.id, page.page_number);
        await store.put(analysisKey, JSON.stringify(analysis), 'application/json');
        await store.put(markdownKey, analysis.markdown, 'text/markdown');
        await db.updatePage(page.id, {
          status: 'completed',
          page_type: analysis.page_type,
          r2_analysis_key: analysisKey,
          r2_markdown_key: markdownKey,
          error: null,
        });

        analyses.set(page.page_number, analysis);
        previousSummary = analysis.context_summary || undefined;
        previousCompletedKey = null;
        completed += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log(`page ${page.page_number} failed: ${message}`);
        await db.updatePage(page.id, { status: 'failed', error: message });
        failed += 1;
        previousSummary = undefined;
        previousCompletedKey = null;
      }
      await db.updateJob(job.id, { progress: Math.round(((completed + failed) / total) * 100) });
    }

    // 過去の実行で完了済みのページのPageAnalysisをR2から復元する
    for (const page of pages) {
      if (analyses.has(page.page_number)) continue;
      if (page.status === 'completed' && page.r2_analysis_key) {
        const loaded = await loadAnalysis(page.r2_analysis_key);
        if (loaded) analyses.set(page.page_number, loaded);
      }
    }
    const analyzedPages: AnalyzedPage[] = [...analyses.entries()]
      .sort(([a], [b]) => a - b)
      .map(([pageNumber, analysis]) => ({ pageNumber, analysis }));

    // 結合Markdown（full.md）
    const markdownParts = analyzedPages
      .map((page) => page.analysis.markdown.trim())
      .filter((markdown) => markdown !== '');
    if (markdownParts.length > 0) {
      await store.put(
        r2FullMarkdownKey(document.user_id, document.id),
        markdownParts.join('\n\n'),
        'text/markdown',
      );
    }

    if (failed > 0) {
      await db.updateJob(job.id, {
        status: 'failed',
        error: `${failed} page(s) failed`,
        finished_at: new Date().toISOString(),
      });
      await db.updateDocument(document.id, { status: 'failed' });
      log(`job ${job.id} finished with ${failed} failed page(s)`);
      return;
    }

    // M3: Knowledge化（KPS §4〜§6）。全ページ成功時のみ
    if (deps.knowledge) {
      await runKnowledgeStage({ db, ...deps.knowledge }, document, analyzedPages, log);
    }

    await db.updateJob(job.id, {
      status: 'completed',
      progress: 100,
      error: null,
      finished_at: new Date().toISOString(),
    });
    await db.updateDocument(document.id, { status: 'completed' });
    log(`job ${job.id} completed`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`job ${job.id} failed: ${message}`);
    await db.updateJob(job.id, {
      status: 'failed',
      error: message,
      finished_at: new Date().toISOString(),
    });
    await db.updateDocument(job.document_id, { status: 'failed' });
    throw e;
  }
}
