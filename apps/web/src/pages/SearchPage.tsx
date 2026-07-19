import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';

import { searchApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchApi.search(query),
    enabled: query.trim() !== '',
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Search</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        書名を思い出せなくても、内容で蔵書を横断検索できます。
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例: リスクの定量的な評価手法"
          aria-label="検索キーワード"
        />
        <Button type="submit" disabled={input.trim() === '' || isFetching}>
          {isFetching ? <Loader2 className="animate-spin" /> : <Search />}
          検索
        </Button>
      </form>

      {isError && (
        <p role="alert" className="mt-8 text-sm text-destructive">
          検索に失敗しました: {error.message}
        </p>
      )}

      {data && data.results.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          「{query}」に一致する内容は見つかりませんでした。
        </p>
      )}

      {data && data.results.length > 0 && (
        <ul className="mt-8 space-y-4">
          {data.results.map((result) => (
            <li key={result.chunk_id}>
              <Link
                to={`/documents/${result.document_id}`}
                className="block rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <p className="line-clamp-3 text-sm">{result.content}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {result.document_title} — p.{result.page_start}
                  {result.section_path ? ` ・ ${result.section_path}` : ''}
                  {result.chunk_type !== 'text'
                    ? `（${result.chunk_type === 'figure' ? '図' : '表'}）`
                    : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
