import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Loader2, Trash2, Upload } from 'lucide-react';
import type { Document } from '@pkos/shared';

import { documentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';

function DocumentCard({
  document,
  onDelete,
  deleting,
}: {
  document: Document;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  return (
    <div className="group relative rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <Link to={`/documents/${document.id}`} className="block">
        <div className="flex h-24 items-center justify-center rounded-md bg-muted">
          <BookOpen className="size-8 text-muted-foreground" />
        </div>
        <h2 className="mt-3 line-clamp-2 font-medium">{document.title}</h2>
        {document.author && (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{document.author}</p>
        )}
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={document.status} />
          {document.page_count != null && <span>{document.page_count}ページ</span>}
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${document.title}を削除`}
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        disabled={deleting}
        onClick={() => onDelete(document.id)}
      >
        <Trash2 className="text-muted-foreground" />
      </Button>
    </div>
  );
}

export function LibraryPage() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const handleDelete = (id: string) => {
    const target = data?.documents.find((doc) => doc.id === id);
    if (window.confirm(`「${target?.title ?? 'この書籍'}」を削除しますか？元に戻せません。`)) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <Button asChild>
          <Link to="/upload">
            <Upload />
            アップロード
          </Link>
        </Button>
      </div>

      {isPending && (
        <div className="mt-12 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}

      {isError && (
        <p role="alert" className="mt-12 text-center text-sm text-destructive">
          読み込みに失敗しました: {error.message}
        </p>
      )}

      {data && data.documents.length === 0 && (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="font-medium">まだ書籍がありません</p>
          <p className="max-w-md text-sm text-muted-foreground">
            所有している専門書の写真やPDFをアップロードすると、AIが解析して構造化された知識に変換します。
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link to="/upload">最初の書籍をアップロード</Link>
          </Button>
        </div>
      )}

      {data && data.documents.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {data.documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onDelete={handleDelete}
              deleting={deleteMutation.isPending && deleteMutation.variables === doc.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
