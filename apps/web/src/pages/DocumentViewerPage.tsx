import { useParams } from 'react-router-dom';

// M2-08 で Markdown 表示（sanitize + 目次）を実装する
export function DocumentViewerPage() {
  const { documentId } = useParams<{ documentId: string }>();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Document Viewer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        ドキュメント {documentId} の表示は M2-08 で実装予定です。
      </p>
    </div>
  );
}
