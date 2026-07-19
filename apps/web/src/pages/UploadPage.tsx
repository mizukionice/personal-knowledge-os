import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, FileText, Image, Loader2, X } from 'lucide-react';
import { IMAGE_MAX_BYTES, PDF_MAX_BYTES, type UploadContentType } from '@pkos/shared';

import { documentsApi, uploadsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_CONCURRENCY = 3;

type ItemStatus = 'pending' | 'uploading' | 'done' | 'failed';

interface UploadItem {
  id: string;
  file: File;
  status: ItemStatus;
  r2Key?: string;
}

export function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPdf = items.length === 1 && items[0]?.file.type === 'application/pdf';
  const doneCount = items.filter((item) => item.status === 'done').length;
  const hasFailed = items.some((item) => item.status === 'failed');

  const addFiles = (fileList: FileList | File[]) => {
    setError(null);
    const files = Array.from(fileList);
    const pdf = files.find((file) => file.type === 'application/pdf');

    if (pdf) {
      if (files.length > 1 || items.length > 0) {
        setError('PDFは1ファイルのみ、写真との混在はできません。');
        return;
      }
      if (pdf.size > PDF_MAX_BYTES) {
        setError('PDFは100MBまでです。');
        return;
      }
      setItems([{ id: crypto.randomUUID(), file: pdf, status: 'pending' }]);
      return;
    }

    const rejected: string[] = [];
    const accepted: UploadItem[] = [];
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) {
        rejected.push(`${file.name}（対応形式: JPEG/PNG/WebP/PDF）`);
      } else if (file.size > IMAGE_MAX_BYTES) {
        rejected.push(`${file.name}（画像は10MBまで）`);
      } else {
        accepted.push({ id: crypto.randomUUID(), file, status: 'pending' });
      }
    }
    if (rejected.length > 0) {
      setError(`追加できないファイルがあります: ${rejected.join(', ')}`);
    }
    if (accepted.length > 0) {
      if (isPdf) {
        setError('PDFと写真は混在できません。');
        return;
      }
      setItems((prev) => [...prev, ...accepted]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!busy) addFiles(e.dataTransfer.files);
  };

  const move = (index: number, delta: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const setItemStatus = (id: string, status: ItemStatus, r2Key?: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status, ...(r2Key ? { r2Key } : {}) } : item,
      ),
    );
  };

  const start = async () => {
    if (!title.trim() || items.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      let docId = documentId;
      if (!docId) {
        const { document } = await documentsApi.create({
          title: title.trim(),
          author: author.trim() || undefined,
          doc_type: isPdf ? 'pdf' : 'book',
        });
        docId = document.id;
        setDocumentId(docId);
      }

      // 配列順 = ページ順。完了済みはスキップし、失敗分のみ再実行できる
      const results = new Map<string, string>(
        items.filter((i) => i.status === 'done' && i.r2Key).map((i) => [i.id, i.r2Key as string]),
      );
      const queue = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.status !== 'done');
      let cursor = 0;
      const failures: string[] = [];

      const worker = async () => {
        while (cursor < queue.length) {
          const entry = queue[cursor];
          cursor += 1;
          if (!entry) break;
          const { item, index } = entry;
          setItemStatus(item.id, 'uploading');
          try {
            const { upload_url, r2_key } = await uploadsApi.getUploadUrl(docId, {
              file_name: item.file.name,
              content_type: item.file.type as UploadContentType,
              ...(isPdf ? {} : { page_number: index + 1 }),
            });
            const res = await fetch(upload_url, { method: 'PUT', body: item.file });
            if (!res.ok) {
              throw new Error(`PUT failed with status ${res.status}`);
            }
            results.set(item.id, r2_key);
            setItemStatus(item.id, 'done', r2_key);
          } catch {
            failures.push(item.file.name);
            setItemStatus(item.id, 'failed');
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, () => worker()),
      );

      if (failures.length > 0) {
        setError(
          `${failures.length}件のアップロードに失敗しました。「失敗分を再試行」で再実行できます。`,
        );
        return;
      }

      const orderedKeys = items
        .map((item) => results.get(item.id))
        .filter((key): key is string => Boolean(key));
      await uploadsApi.complete(docId, orderedKeys);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロードに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Upload</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        書籍の写真（ページ順）またはPDFをアップロードします。
      </p>

      <div className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">書籍タイトル（必須）</Label>
          <Input
            id="title"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: リスクマネジメント概論"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="author">著者（任意）</Label>
          <Input
            id="author"
            value={author}
            disabled={busy}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="ファイルを追加"
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed py-10 text-center transition-colors hover:bg-accent/50',
            busy && 'pointer-events-none opacity-50',
          )}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <Image className="size-6 text-muted-foreground" />
          <p className="text-sm">クリックして選択、またはドラッグ&ドロップ</p>
          <p className="text-xs text-muted-foreground">
            写真（JPEG/PNG/WebP、10MBまで）複数 or PDF（100MBまで）1つ
          </p>
          <input
            ref={inputRef}
            type="file"
            aria-label="ファイルを選択"
            className="hidden"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={handleFileChange}
          />
        </div>

        {items.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {items.map((item, index) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
                  {isPdf ? 'PDF' : `p.${index + 1}`}
                </span>
                {item.file.type === 'application/pdf' ? (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Image className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    item.status === 'done' && 'text-primary',
                    item.status === 'failed' && 'text-destructive',
                    item.status === 'uploading' && 'text-muted-foreground',
                  )}
                >
                  {item.status === 'pending' && '待機中'}
                  {item.status === 'uploading' && 'アップロード中…'}
                  {item.status === 'done' && '完了'}
                  {item.status === 'failed' && '失敗'}
                </span>
                {!busy && item.status !== 'done' && (
                  <span className="flex shrink-0 items-center">
                    {!isPdf && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${item.file.name}を上へ`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${item.file.name}を下へ`}
                          disabled={index === items.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${item.file.name}を取り除く`}
                      onClick={() => remove(item.id)}
                    >
                      <X />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {busy && items.length > 0 && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(doneCount / items.length) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {doneCount} / {items.length} 完了
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button onClick={start} disabled={busy || !title.trim() || items.length === 0}>
          {busy && <Loader2 className="animate-spin" />}
          {hasFailed ? '失敗分を再試行' : 'アップロード開始'}
        </Button>
      </div>
    </div>
  );
}
