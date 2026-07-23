import type {
  AdminUserRow,
  AppSettings,
  Document,
  Job,
  PagesSummary,
  UpdateUserPermissionsRequest,
  UploadUrlRequest,
  UploadUrlResponse,
  UserProfile,
} from '@pkos/shared';

import { supabase } from '@/lib/supabase';

// 末尾スラッシュは除去する（`${API_BASE}/v1/...` が `//v1` になり全ルート404になるため）
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787').replace(
  /\/+$/,
  '',
);

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

export const jobsApi = {
  process: (documentId: string) =>
    apiFetch<{ job: Job }>(`/documents/${documentId}/process`, { method: 'POST' }),
  list: (documentId: string) => apiFetch<{ jobs: Job[] }>(`/jobs?document_id=${documentId}`),
};

export const contentApi = {
  markdown: (documentId: string) =>
    apiFetch<{ markdown: string }>(`/documents/${documentId}/markdown`),
};

export interface SearchResult {
  chunk_id: string;
  content: string;
  chunk_type: string;
  document_id: string;
  document_title: string;
  page_start: number;
  page_end: number;
  section_path: string | null;
  score: number;
}

export const searchApi = {
  search: (q: string) =>
    apiFetch<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`),
};

export interface ConceptSummary {
  id: string;
  canonical_name: string;
  aliases?: string[];
  importance: number;
  mention_count: number;
}

export interface ConceptDetail {
  concept: { id: string; canonical_name: string; aliases: string[]; importance: number };
  definitions: {
    definition: string | null;
    document_id: string;
    document_title: string | null;
    page_start: number | null;
    section_path: string | null;
  }[];
  related: {
    concept_id: string | null;
    canonical_name: string | null;
    relation: 'is_a' | 'part_of' | 'relates_to' | 'contradicts' | 'same_as';
    direction: 'outgoing' | 'incoming';
  }[];
}

export const conceptsApi = {
  list: (q?: string) =>
    apiFetch<{ concepts: ConceptSummary[] }>(`/concepts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (id: string) => apiFetch<ConceptDetail>(`/concepts/${id}`),
  forDocument: (documentId: string) =>
    apiFetch<{ concepts: ConceptSummary[] }>(`/documents/${documentId}/concepts`),
};

export interface ChatCitation {
  document_id: string;
  title: string;
  page: number;
  section_path: string | null;
}

export interface ChatStreamResult {
  citations: ChatCitation[];
  used_general_knowledge: boolean;
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const chatApi = {
  /** POST /chat のSSEを読み、deltaごとにonDeltaを呼ぶ。doneイベントの内容を返す */
  stream: async (
    message: string,
    history: ChatHistoryTurn[],
    onDelta: (text: string) => void,
  ): Promise<ChatStreamResult> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const res = await fetch(`${API_BASE}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, history }),
    });
    if (!res.ok || !res.body) {
      const body: unknown = await res.json().catch(() => null);
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiRequestError(
        err?.code ?? 'internal',
        err?.message ?? `chat failed with status ${res.status}`,
        res.status,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ChatStreamResult | null = null;
    let streamError: string | null = null;

    const handleBlock = (block: string) => {
      const eventMatch = /^event: (.+)$/m.exec(block);
      const dataMatch = /^data: (.+)$/m.exec(block);
      if (!eventMatch || !dataMatch) return;
      const payload: unknown = JSON.parse(dataMatch[1]!);
      if (eventMatch[1] === 'delta') {
        onDelta((payload as { text: string }).text);
      } else if (eventMatch[1] === 'done') {
        result = payload as ChatStreamResult;
      } else if (eventMatch[1] === 'error') {
        streamError = (payload as { message: string }).message;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      blocks.forEach(handleBlock);
    }
    if (buffer.trim() !== '') handleBlock(buffer);

    if (streamError) throw new ApiRequestError('internal', streamError, 500);
    if (!result) throw new ApiRequestError('internal', '回答ストリームが途中で終了しました', 500);
    return result;
  },
};

export const profileApi = {
  /** 自分のuser_profiles行（RLSで自行のみ読める）。行が無ければnull */
  getOwn: async (): Promise<UserProfile | null> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return null;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id, role, can_upload, can_process, can_chat')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as UserProfile | null) ?? null;
  },
};

export const adminApi = {
  getSettings: () => apiFetch<{ settings: AppSettings }>('/admin/settings'),
  updateSettings: (signupEnabled: boolean) =>
    apiFetch<{ settings: AppSettings }>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ signup_enabled: signupEnabled }),
    }),
  listUsers: () => apiFetch<{ users: AdminUserRow[] }>('/admin/users'),
  updateUser: (userId: string, input: UpdateUserPermissionsRequest) =>
    apiFetch<{ profile: UserProfile }>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

export const uploadsApi = {
  getUploadUrl: (documentId: string, input: UploadUrlRequest) =>
    apiFetch<UploadUrlResponse>(`/documents/${documentId}/upload-url`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  complete: (documentId: string, r2Keys: string[]) =>
    apiFetch<{ document: Document }>(`/documents/${documentId}/uploads/complete`, {
      method: 'POST',
      body: JSON.stringify({ r2_keys: r2Keys }),
    }),
};
