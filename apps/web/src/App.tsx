import { Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { DocumentViewerPage } from '@/pages/DocumentViewerPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UploadPage } from '@/pages/UploadPage';

// 認証ガードは M1-02（Supabase Auth）で追加する
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/documents/:documentId" element={<DocumentViewerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
