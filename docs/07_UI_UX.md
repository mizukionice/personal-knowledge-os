# 07_UI_UX — UI設計

## 方針
- デスクトップブラウザ優先、スマホでもアップロードは快適に（撮影→即アップロード）
- ライブラリ: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- Markdown表示: react-markdown + rehype-sanitize（XSS対策必須）
- 状態管理はTanStack Query（サーバー状態）+ 最小限のローカル状態。Reduxは使わない

## 画面一覧
1. **Login / Signup** — Supabase Auth（email+password）。
2. **Library（ダッシュボード）** — 書籍カード一覧（表紙サムネ・タイトル・処理状態バッジ・ページ数）。処理中はプログレス表示（jobsポーリング5秒）。空状態では使い方ガイド
3. **Upload** — 書籍タイトル入力 → 写真複数選択（またはPDF1つ）→ ドラッグ&ドロップ/カメラ起動 → 並び替え → 一括アップロード（進捗バー、個別リトライ）→ 「処理開始」ボタン
4. **Document Viewer** — 左: ページサムネ/目次（section一覧）、中央: Markdown表示、右サイドバー: この本の概念リスト（クリックで概念詳細へ）。図表は説明文と共に表示
5. **Search（M3）** — 検索ボックス → 結果カード（ハイライト付き本文断片 + 書名 + ページ + セクション）。クリックでViewerの該当ページへ
6. **Concept詳細（M3）** — 概念名・別名・定義（出典別に併記）・出現書籍・関連概念（relation別、contradictsは強調表示）
7. **Chat（M4）** — チャットUI。回答内の引用 `[書名 p.145]` はリンクになっており、クリックでViewerへ。根拠のない回答には「ライブラリ外の一般知識」バッジ
8. **Settings** — プロフィール、ログアウト、（将来）モデル設定

## 画面遷移
Login → Library → (Upload | Document Viewer | Search | Chat | Settings)
Viewer⇄Concept⇄Search⇄Chatは相互リンク（citationとconceptが遷移のハブ）

## デザイン原則
- 「読書ノートの本棚」の落ち着いたトーン。ダークモード対応は後回し
- 処理待ちが数分あるため、進捗の可視化（n/Nページ完了）と失敗ページの明示・再実行ボタンを最優先のUXとする
