import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { conceptsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const RELATION_LABELS: Record<string, string> = {
  is_a: '上位/下位',
  part_of: '構成要素',
  relates_to: '関連',
  contradicts: '矛盾',
  same_as: '同一',
};

export function ConceptPage() {
  const { conceptId } = useParams<{ conceptId: string }>();

  const { data, isPending, isError } = useQuery({
    queryKey: ['concept', conceptId],
    queryFn: () => conceptsApi.get(conceptId as string),
    enabled: Boolean(conceptId),
  });

  if (isPending) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p role="alert" className="py-24 text-center text-sm text-destructive">
        概念を読み込めませんでした。
      </p>
    );
  }

  const { concept, definitions, related } = data;
  const contradictions = related.filter((r) => r.relation === 'contradicts');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">{concept.canonical_name}</h1>
      {concept.aliases.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">別名: {concept.aliases.join('、')}</p>
      )}

      {contradictions.length > 0 && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <AlertTriangle className="size-4 text-destructive" />
          <span>この概念には矛盾する主張が記録されています（{contradictions.length}件）</span>
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-medium">定義（出典別）</h2>
        {definitions.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">定義はまだ記録されていません。</p>
        )}
        <ul className="mt-2 space-y-3">
          {definitions.map((def, index) => (
            <li key={index} className="rounded-lg border bg-card p-4">
              <p className="text-sm">{def.definition ?? '（定義なし）'}</p>
              <Link
                to={`/documents/${def.document_id}`}
                className="mt-2 block text-xs text-muted-foreground hover:text-foreground"
              >
                {def.document_title ?? '不明な書籍'}
                {def.page_start != null ? ` — p.${def.page_start}` : ''}
                {def.section_path ? ` ・ ${def.section_path}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-medium">関連概念</h2>
        {related.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">関連概念はまだありません。</p>
        )}
        <ul className="mt-2 flex flex-wrap gap-2">
          {related.map(
            (rel, index) =>
              rel.concept_id && (
                <li key={index}>
                  <Link
                    to={`/concepts/${rel.concept_id}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-accent',
                      rel.relation === 'contradicts' &&
                        'border-destructive/40 bg-destructive/5 text-destructive',
                    )}
                  >
                    {rel.canonical_name}
                    <span className="text-xs text-muted-foreground">
                      {RELATION_LABELS[rel.relation] ?? rel.relation}
                    </span>
                  </Link>
                </li>
              ),
          )}
        </ul>
      </section>
    </div>
  );
}
