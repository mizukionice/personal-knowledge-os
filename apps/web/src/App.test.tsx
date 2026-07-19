import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from '@/App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('App routing', () => {
  it('renders Library at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Library' })).toBeDefined();
  });

  it('renders Login at /login', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeDefined();
  });

  it('renders Upload at /upload', () => {
    renderAt('/upload');
    expect(screen.getByRole('heading', { name: 'Upload' })).toBeDefined();
  });

  it('renders Document Viewer at /documents/:id', () => {
    renderAt('/documents/abc-123');
    expect(screen.getByRole('heading', { name: 'Document Viewer' })).toBeDefined();
    expect(screen.getByText(/abc-123/)).toBeDefined();
  });

  it('renders NotFound for unknown paths', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeDefined();
  });
});
