import type { Document, PagesSummary } from '@pkos/shared';

import { supabase } from '@/lib/supabase';

const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

/** Workers API（/v1）への認証付きfetch。JWTはSupabaseセッションから取得する */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_BASE}/v1${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiRequestError(
      err?.code ?? 'internal',
      err?.message ?? `request failed with status ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

export interface DocumentWithSummary extends Document {
  pages_summary: PagesSummary;
}

export const documentsApi = {
  list: () => apiFetch<{ documents: Document[]; total: number }>('/documents'),
  get: (id: string) => apiFetch<{ document: DocumentWithSummary }>(`/documents/${id}`),
  create: (input: { title: string; author?: string; doc_type?: Document['doc_type'] }) =>
    apiFetch<{ document: Document }>('/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => apiFetch<void>(`/documents/${id}`, { method: 'DELETE' }),
};
