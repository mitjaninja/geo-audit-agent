import type { LevelDef, Move } from '@sakura/core';

/** Ответы сервера (apps/server/src/service.ts). Дублируем типы, чтобы клиент не тянул серверный код. */
export interface LivesView {
  readonly lives: number;
  readonly max: number;
  readonly nextLifeAt: number | null;
  readonly infiniteUntil: number | null;
}

export type Item = 'beamBomb' | 'rainbow' | 'extraMoves' | 'hammer' | 'freeSwap' | 'shuffle';
export type ProductId = 'pack10' | 'pack50' | 'pack100' | 'pack250' | 'pack500' | 'starter' | 'piggy';

export interface WalletView {
  readonly crystals: number;
  readonly items: Readonly<Record<Item, number>>;
  readonly piggy: number;
  /** Стартовый пак доступен до этого момента (часы сервера); null — нет. */
  readonly starterUntil: number | null;
}

export interface ShopView {
  readonly itemPrices: Readonly<Record<Item, number>>;
  readonly refillLives: number;
  readonly extendPrices: readonly number[];
  readonly extendMoves: number;
  readonly packs: Readonly<Record<'pack10' | 'pack50' | 'pack100' | 'pack250' | 'pack500', { crystals: number; stars: number; bonus: number; title: string }>>;
  readonly starter: { readonly stars: number; readonly crystals: number; readonly items: Partial<Record<Item, number>>; readonly infiniteLivesMs: number };
  readonly piggy: { readonly stars: number; readonly max: number; readonly minToBreak: number };
}

export interface Me {
  readonly user: { readonly id: number; readonly firstName: string };
  readonly lives: LivesView;
  readonly wallet: WalletView;
  readonly maxLevel: number;
  readonly levels: Record<string, { readonly stars: number; readonly bestScore: number }>;
  readonly levelCount: number;
  readonly serverTime: number;
  /** Ходы и время уровней, сдвинутые remote config на сервере. */
  readonly levelOverrides?: Record<string, { readonly moves?: number; readonly timeLimit?: number }>;
}

export interface Attempt {
  readonly attemptId: string;
  readonly seed: number;
  readonly level: LevelDef;
  readonly lives: LivesView;
  readonly wallet: WalletView;
  /** Параметры партии от сервера: без них реплей на сервере не сойдётся. */
  readonly assist: number;
  readonly startBoosters: readonly Item[];
}

export interface FinishResult {
  readonly result: 'won' | 'lost';
  readonly score: number;
  readonly stars: number;
  readonly bestScore: number;
  readonly lives: LivesView;
  readonly maxLevel: number;
  readonly wallet: WalletView;
  /** Попытка в комнате чата: место в рейтинге. */
  readonly room?: { readonly id: string; readonly place: number; readonly players: number };
}

export interface RoomView {
  readonly id: string;
  readonly mode: 'challenge' | 'help';
  readonly levelId: number;
  readonly creatorName: string;
  readonly expiresAt: number;
  readonly expired: boolean;
  readonly players: number;
  readonly top: readonly { readonly place: number; readonly name: string; readonly score: number; readonly stars: number }[];
  readonly me: { readonly place: number | null; readonly bestScore: number | null; readonly attempts: number };
  readonly nextAttemptFree: boolean;
  readonly gifts: number;
  readonly maxGifts: number;
  readonly serverTime: number;
}

export interface CreatedRoom {
  readonly roomId: string;
  readonly mode: 'challenge' | 'help';
  readonly levelId: number;
  /** Карточка для Telegram.WebApp.shareMessage; null — бот не настроен (разработка). */
  readonly preparedMessageId: string | null;
  readonly link: string | null;
}

export type Auth = { readonly kind: 'tma'; readonly initData: string } | { readonly kind: 'dev'; readonly userId: string };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown>) {
    super(`${status} ${code}`);
  }
}

export interface ClientEvent {
  readonly name: 'session_start' | 'session_end' | 'hint_shown' | 'tutorial_complete' | 'moves_offer_shown' | 'shop_opened';
  readonly levelId?: number;
  readonly props?: Record<string, unknown>;
}

export interface Api {
  me(): Promise<Me>;
  /** Аналитика; keepalive — запрос доходит, даже если Mini App сворачивают. Ошибки глотаются. */
  events(events: readonly ClientEvent[]): Promise<void>;
  start(levelId: number, boosters?: readonly Item[]): Promise<Attempt>;
  finish(attemptId: string, moves: readonly Move[], timedOut: boolean): Promise<FinishResult>;
  createRoom(mode: 'challenge' | 'help'): Promise<CreatedRoom>;
  room(id: string): Promise<RoomView>;
  startRoom(id: string, boosters?: readonly Item[]): Promise<Attempt>;
  /** «+5 ходов»: сервер проигрывает ходы, проверяет, что они кончились, и списывает кристаллы. */
  extend(attemptId: string, moves: readonly Move[]): Promise<{ price: number; extensions: number; wallet: WalletView }>;
  shop(): Promise<ShopView>;
  buy(item: Item, count?: number): Promise<{ wallet: WalletView }>;
  refillLives(): Promise<{ lives: LivesView; wallet: WalletView }>;
  /** Счёт в Telegram Stars: ссылка для Telegram.WebApp.openInvoice. */
  purchase(product: ProductId): Promise<{ invoiceId: string; stars: number; link: string }>;
}

export function createApi(auth: Auth, base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): Api {
  const authorization = auth.kind === 'tma' ? `tma ${auth.initData}` : `dev ${auth.userId}`;
  async function call<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
    const res = await fetchImpl(base + path, {
      method,
      headers: { authorization, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(keepalive ? { keepalive: true } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json);
    return json as T;
  }
  return {
    me: () => call<Me>('GET', '/api/me'),
    events: (events) => call<unknown>('POST', '/api/events', { events }, true).then(() => undefined, () => undefined),
    start: (levelId, boosters = []) => call<Attempt>('POST', '/api/attempts', { levelId, boosters }),
    finish: (attemptId, moves, timedOut) => call<FinishResult>('POST', `/api/attempts/${attemptId}/finish`, { swaps: moves, timedOut }),
    createRoom: (mode) => call<CreatedRoom>('POST', '/api/rooms', { mode }),
    room: (id) => call<RoomView>('GET', `/api/rooms/${encodeURIComponent(id)}`),
    startRoom: (id, boosters = []) => call<Attempt>('POST', `/api/rooms/${encodeURIComponent(id)}/attempts`, { boosters }),
    extend: (attemptId, moves) => call('POST', `/api/attempts/${attemptId}/extend`, { moves }),
    shop: () => call<ShopView>('GET', '/api/shop'),
    buy: (item, count = 1) => call('POST', '/api/shop/buy', { item, count }),
    refillLives: () => call('POST', '/api/lives/refill'),
    purchase: (product) => call('POST', '/api/purchases', { product }),
  };
}
