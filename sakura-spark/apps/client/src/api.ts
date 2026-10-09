import type { LevelDef, Swap } from '@sakura/core';

/** Ответы сервера (apps/server/src/service.ts). Дублируем типы, чтобы клиент не тянул серверный код. */
export interface LivesView {
  readonly lives: number;
  readonly max: number;
  readonly nextLifeAt: number | null;
  readonly infiniteUntil: number | null;
}

export interface Me {
  readonly user: { readonly id: number; readonly firstName: string };
  readonly lives: LivesView;
  readonly maxLevel: number;
  readonly levels: Record<string, { readonly stars: number; readonly bestScore: number }>;
  readonly levelCount: number;
  readonly serverTime: number;
}

export interface Attempt {
  readonly attemptId: string;
  readonly seed: number;
  readonly level: LevelDef;
  readonly lives: LivesView;
}

export interface FinishResult {
  readonly result: 'won' | 'lost';
  readonly score: number;
  readonly stars: number;
  readonly bestScore: number;
  readonly lives: LivesView;
  readonly maxLevel: number;
}

export type Auth = { readonly kind: 'tma'; readonly initData: string } | { readonly kind: 'dev'; readonly userId: string };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown>) {
    super(`${status} ${code}`);
  }
}

export interface Api {
  me(): Promise<Me>;
  start(levelId: number): Promise<Attempt>;
  finish(attemptId: string, swaps: readonly Swap[], timedOut: boolean): Promise<FinishResult>;
}

export function createApi(auth: Auth, base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): Api {
  const authorization = auth.kind === 'tma' ? `tma ${auth.initData}` : `dev ${auth.userId}`;
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(base + path, {
      method,
      headers: { authorization, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json);
    return json as T;
  }
  return {
    me: () => call<Me>('GET', '/api/me'),
    start: (levelId) => call<Attempt>('POST', '/api/attempts', { levelId }),
    finish: (attemptId, swaps, timedOut) => call<FinishResult>('POST', `/api/attempts/${attemptId}/finish`, { swaps, timedOut }),
  };
}
