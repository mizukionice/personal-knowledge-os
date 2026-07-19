import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

// M1-06 で書籍カード一覧・削除・処理状態バッジを実装する
export function LibraryPage() {
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
      <div className="mt-12 flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="font-medium">まだ書籍がありません</p>
        <p className="max-w-md text-sm text-muted-foreground">
          所有している専門書の写真やPDFをアップロードすると、AIが解析して構造化された知識に変換します。
        </p>
      </div>
    </div>
  );
}
