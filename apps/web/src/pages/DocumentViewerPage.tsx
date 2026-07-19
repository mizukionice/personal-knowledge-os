import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';

import { Link } from 'react-router-dom';

import { conceptsApi, contentApi, documentsApi, jobsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';

/** 見出しテキスト→アンカーid（目次リンク用） */
function slugify(text: string): string {
  return encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, '-'));
}

function headingText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(headingText).join('');
  return '';
}

interface TocEntry {
  level: number;
  title: string;
}

/** Markdown文字列から目次（見出し一覧）を抽出する */
function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) {
      entries.push({ level: match[1].length, title: match[2].trim() });
    }
  }
  return entries;
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 id={slugify(headingText(children))}>{children}</h1>,
  h2: ({ children }) => <h2 id={slugify(headingText(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(headingText(children))}>{children}</h3>,
  h4: ({ children }) => <h4 id={slugify(headingText(children))}>{children}</h4>,
};

export function DocumentViewerPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => documentsApi.get(documentId as string),
    enabled: Boolean(documentId),
    // 処理中は5秒ポーリング（07_UI_UX）
    refetchInterval: (query) => {
      const status = query.state.data?.document.status;
      return status === 'processing' || status === 'uploading' ? 5000 : false;
    },
  });

  const doc = documentQuery.data?.document;
  const isProcessing = doc?.status === 'processing' || doc?.status === 'uploading';

  const jobQuery = useQuery({
    queryKey: ['jobs', documentId],
    queryFn: () => jobsApi.list(documentId as string),
    enabled: Boolean(documentId) && isProcessing,
    refetchInterval: 5000,
  });

  const markdownQuery = useQuery({
    queryKey: ['markdown', documentId],
    queryFn: () => contentApi.markdown(documentId as string),
    // 全部失敗した書籍でも、部分的に生成済みのfull.mdがあれば表示する
    enabled: Boolean(documentId) && (doc?.status === 'completed' || doc?.status === 'failed'),
    retry: false,
  });

  const conceptsQuery = useQuery({
    queryKey: ['document-concepts', documentId],
    queryFn: () => conceptsApi.forDocument(documentId as string),
    enabled: Boolean(documentId) && doc?.status === 'completed',
  });

  const reprocess = useMutation({
    mutationFn: () => jobsApi.process(documentId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs', documentId] });
    },
  });

  const toc = useMemo(
    () => extractToc(markdownQuery.data?.markdown ?? ''),
    [markdownQuery.data?.markdown],
  );

  if (documentQuery.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
      </div>
    );
  }
  if (documentQuery.isError || !doc) {
    return (
      <p role="alert" className="py-24 text-center text-sm text-destructive">
        書籍を読み込めませんでした。
      </p>
    );
  }

  const summary = doc.pages_summary;
  const latestJob = jobQuery.data?.jobs[0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{doc.title}</h1>
        <StatusBadge status={doc.status} />
        {doc.author && <span className="text-sm text-muted-foreground">{doc.author}</span>}
      </div>

      {isProcessing && (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span>
              処理中… {summary.completed + summary.failed} / {summary.total} ページ完了
              {latestJob ? `（進捗 ${latestJob.progress}%）` : ''}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${summary.total > 0 ? ((summary.completed + summary.failed) / summary.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {summary.failed > 0 && !isProcessing && (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <AlertTriangle className="size-4 text-destructive" />
          <span>{summary.failed}ページの処理に失敗しました。</span>
          <Button
            size="sm"
            variant="outline"
            disabled={reprocess.isPending}
            onClick={() => reprocess.mutate()}
          >
            <RotateCcw />
            失敗ページを再実行
          </Button>
          {reprocess.isError && <span className="text-destructive">{reprocess.error.message}</span>}
        </div>
      )}

      {markdownQuery.data && (
        <div className="mt-8 flex gap-8">
          {toc.length > 0 && (
            <nav aria-label="目次" className="hidden w-56 shrink-0 lg:block">
              <p className="text-sm font-medium">目次</p>
              <ul className="mt-2 space-y-1 border-l pl-3 text-sm">
                {toc.map((entry, index) => (
                  <li
                    key={`${entry.title}-${index}`}
                    style={{ marginLeft: (entry.level - 1) * 12 }}
                  >
                    <a
                      href={`#${slugify(entry.title)}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <article className="prose-pkos min-w-0 flex-1">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={markdownComponents}
            >
              {markdownQuery.data.markdown}
            </ReactMarkdown>
          </article>
          {conceptsQuery.data && conceptsQuery.data.concepts.length > 0 && (
            <aside aria-label="この本の概念" className="hidden w-56 shrink-0 xl:block">
              <p className="text-sm font-medium">この本の概念</p>
              <ul className="mt-2 space-y-1 text-sm">
                {conceptsQuery.data.concepts.map((concept) => (
                  <li key={concept.id}>
                    <Link
                      to={`/concepts/${concept.id}`}
                      className="flex items-baseline justify-between gap-2 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="truncate">{concept.canonical_name}</span>
                      <span className="shrink-0 text-xs">{concept.mention_count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}

      {markdownQuery.isError && !isProcessing && (
        <p className="mt-8 text-sm text-muted-foreground">
          Markdownはまだ生成されていません。処理が完了すると表示されます。
        </p>
      )}
    </div>
  );
}
