import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">ページが見つかりません</h1>
      <Button asChild variant="outline">
        <Link to="/">Libraryへ戻る</Link>
      </Button>
    </div>
  );
}
