import { Route, Routes } from 'react-router-dom';

import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { DocumentViewerPage } from '@/pages/DocumentViewerPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UploadPage } from '@/pages/UploadPage';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/documents/:documentId" element={<DocumentViewerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
