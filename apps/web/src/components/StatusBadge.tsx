import type { DocumentStatus } from '@pkos/shared';

import { cn } from '@/lib/utils';

const STYLE_BY_STATUS: Record<DocumentStatus, { label: string; className: string }> = {
  created: { label: '作成済み', className: 'bg-secondary text-secondary-foreground' },
  uploading: { label: 'アップロード中', className: 'bg-accent text-accent-foreground' },
  processing: { label: '処理中', className: 'bg-accent text-accent-foreground' },
  completed: { label: '完了', className: 'bg-primary/10 text-primary' },
  failed: { label: '失敗', className: 'bg-destructive/10 text-destructive' },
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const style = STYLE_BY_STATUS[status] ?? STYLE_BY_STATUS.created;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}
