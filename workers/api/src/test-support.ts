import { vi } from 'vitest';

/** supabase-jsクエリビルダーの最小フェイク（テスト専用） */

export interface FakeResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export function fakeQuery(result: FakeResult) {
  const q = {
    select: () => q,
    insert: () => q,
    update: () => q,
    upsert: () => q,
    delete: () => q,
    order: () => q,
    range: () => q,
    limit: () => q,
    eq: () => q,
    ilike: () => q,
    or: () => q,
    contains: () => q,
    in: () => q,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

/** table名→結果（配列なら呼び出し順に消費、最後の要素を繰り返す）からfrom()を組み立てる */
export function fakeDb(
  resultsByTable: Record<string, FakeResult | FakeResult[]>,
  rpcResults: Record<string, FakeResult> = {},
) {
  const callCount: Record<string, number> = {};
  const from = vi.fn((table: string) => {
    const entry = resultsByTable[table];
    if (entry === undefined) {
      // 権限ミドルウェアのプロフィール参照は、指定が無ければ「行なし＝既定で全機能許可」にする
      if (table === 'user_profiles') {
        return fakeQuery({ data: null, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    }
    const results = Array.isArray(entry) ? entry : [entry];
    const index = Math.min(callCount[table] ?? 0, results.length - 1);
    callCount[table] = (callCount[table] ?? 0) + 1;
    return fakeQuery(results[index] as FakeResult);
  });
  const rpc = vi.fn(async (fn: string) => {
    const result = rpcResults[fn];
    if (result === undefined) {
      throw new Error(`unexpected rpc: ${fn}`);
    }
    return result;
  });
  return { from, rpc };
}
