import type { LevelDef, Move } from '@sakura/core';

/** Ответы сервера (apps/server/src/service.ts). Дублируем типы, чтобы клиент не тянул серверный код. */
export interface LivesView {
  readonly lives: number;
  readonly max: number;
  readonly nextLifeAt: number | null;
  readonly infiniteUntil: number | null;
}

export type Item = 'beamBomb' | 'rainbow' | 'extraMoves' | 'hammer' | 'freeSwap' | 'shuffle';
export type ProductId = 'pass' | 'pack10' | 'pack50' | 'pack100' | 'pack250' | 'pack500' | 'starter' | 'piggy';

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
  readonly social?: { readonly referralCrystals: number; readonly referralLevel: number; readonly giftsPerDay: number };
}

export interface Me {
  readonly user: { readonly id: number; readonly firstName: string };
  readonly lives: LivesView;
  readonly wallet: WalletView;
  readonly maxLevel: number;
  readonly levels: Record<string, { readonly stars: number; readonly bestScore: number }>;
  readonly levelCount: number;
  readonly serverTime: number;
  /** Закрытые ворота нового района, у которых стоит игрок. */
  readonly gate?: GateView | null;
  /** Серия побед на карте. */
  readonly streak?: number;
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
  readonly streak?: number;
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
  /** Победа привела к воротам нового района. */
  readonly gate?: GateView;
  /** Выпала карточка коллекции. */
  readonly drop?: { readonly card: string; readonly title: string };
  /** Награда за уровень фестиваля. */
  readonly festivalReward?: Reward;
}

/** Ворота района: 3 ключа от друзей, или подождать до unlockAt, или price кристаллов. */
export interface GateView {
  readonly episode: number;
  readonly levelId: number;
  readonly keys: number;
  readonly needed: number;
  readonly unlockAt: number;
  readonly price: number;
}

export interface MailItem {
  readonly id: number;
  readonly kind: 'life' | 'ask_life' | 'ask_key';
  readonly from: { readonly id: number; readonly name: string };
  readonly episode: number | null;
  readonly createdAt: number;
}

export interface FriendsView {
  readonly friends: readonly { readonly id: number; readonly name: string; readonly maxLevel: number; readonly sentToday: boolean }[];
  readonly giftsLeft: number;
  readonly askedToday: boolean;
  readonly inbox: readonly MailItem[];
  /** Ссылка-приглашение (fr<id>); null — бот не настроен. */
  readonly inviteLink: string | null;
}

export interface RaceView {
  readonly race: {
    readonly id: number; readonly endsAt: number; readonly target: number; readonly ended: boolean; readonly gathering: boolean;
    readonly members: readonly { readonly name: string; readonly progress: number; readonly place: number | null; readonly me: boolean }[];
  } | null;
  readonly canJoin: boolean;
  readonly target: number;
  readonly size: number;
  readonly hours: number;
  readonly prizes: readonly number[];
  readonly serverTime: number;
}

export interface SeasonView {
  readonly pass: {
    readonly season: number; readonly endsAt: number; readonly points: number; readonly pointsPerTier: number; readonly tier: number;
    readonly premium: boolean; readonly passUntil: number | null; readonly price: number;
    readonly tiers: readonly { readonly tier: number; readonly free: Reward; readonly premium: Reward; readonly freeClaimed: boolean; readonly premiumClaimed: boolean }[];
  };
  readonly collection: {
    readonly sets: readonly { readonly id: string; readonly title: string; readonly frame: string; readonly cards: readonly { readonly id: string; readonly title: string; readonly count: number }[] }[];
    readonly extra: readonly { readonly id: string; readonly title: string; readonly count: number }[];
    readonly frames: readonly { readonly id: string; readonly title: string; readonly color: number }[];
    readonly frame: string | null;
  };
  readonly festival: {
    readonly id: string; readonly title: string; readonly intro: string; readonly endsAt: number;
    readonly levels: readonly number[]; readonly done: number; readonly stepReward: Reward; readonly finalReward: Reward;
  } | null;
  readonly serverTime: number;
}

export interface LevelFriend {
  readonly place: number;
  readonly name: string;
  readonly score: number;
  readonly stars: number;
  readonly me: boolean;
}

export type RoomMode = 'challenge' | 'team' | 'duel' | 'help';

export interface RoomView {
  readonly id: string;
  readonly mode: RoomMode;
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
  /** Итог подведён: цель фонаря выполнена, дуэль сыграна или срок вышел. */
  readonly settled?: boolean;
  readonly team?: { readonly progress: number; readonly target: number; readonly reward: Reward } | null;
  readonly duel?: {
    readonly players: readonly { readonly name: string; readonly won: boolean; readonly moves: number | null; readonly score: number }[];
    readonly winner: string | null; readonly full: boolean; readonly reward: Reward;
  } | null;
}

export interface CreatedRoom {
  readonly roomId: string;
  readonly mode: RoomMode;
  readonly levelId: number;
  /** Карточка для Telegram.WebApp.shareMessage; null — бот не настроен (разработка). */
  readonly preparedMessageId: string | null;
  readonly link: string | null;
}

export interface Reward {
  readonly crystals?: number;
  readonly items?: Partial<Record<Item, number>>;
  readonly infiniteLivesMs?: number;
  readonly card?: string;
  readonly frame?: string;
}

export type TaskKind = 'win' | 'stars' | 'threeStars' | 'booster' | 'score' | 'room';

export interface TaskState {
  readonly kind: TaskKind;
  readonly target: number;
  readonly progress: number;
  readonly claimed: boolean;
  readonly reward: Reward;
}

/** Мета: календарь входа, задания, сундуки эпизодов, колесо, карточки, помощь застрявшему. */
export interface MetaView {
  readonly day: number;
  readonly nextDayAt: number;
  readonly login: { readonly count: number; readonly claimedToday: boolean; readonly position: number; readonly rewards: readonly Reward[] };
  readonly tasks: readonly TaskState[];
  readonly chests: readonly {
    readonly episode: number; readonly stars: number;
    readonly tiers: readonly { readonly tier: number; readonly reward: Reward; readonly claimed: boolean; readonly available: boolean }[];
  }[];
  readonly wheel: { readonly free: boolean; readonly extraLeft: number; readonly price: number; readonly prizes: readonly { readonly id: string; readonly weight: number; readonly reward: Reward }[] };
  readonly cards: Readonly<Record<string, number>>;
  readonly stuck: { readonly levelId: number; readonly reward: Reward } | null;
}

export interface MetaClaim {
  readonly reward: Reward;
  readonly wallet: WalletView;
  readonly lives: LivesView;
  readonly meta: MetaView;
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
  createRoom(mode: RoomMode): Promise<CreatedRoom>;
  room(id: string): Promise<RoomView>;
  startRoom(id: string, boosters?: readonly Item[]): Promise<Attempt>;
  /** «+5 ходов»: сервер проигрывает ходы, проверяет, что они кончились, и списывает кристаллы. */
  extend(attemptId: string, moves: readonly Move[]): Promise<{ price: number; extensions: number; wallet: WalletView }>;
  shop(): Promise<ShopView>;
  buy(item: Item, count?: number): Promise<{ wallet: WalletView }>;
  refillLives(): Promise<{ lives: LivesView; wallet: WalletView }>;
  /** Счёт в Telegram Stars: ссылка для Telegram.WebApp.openInvoice. */
  purchase(product: ProductId): Promise<{ invoiceId: string; stars: number; link: string }>;
  meta(): Promise<MetaView>;
  claimLogin(): Promise<MetaClaim>;
  claimTask(slot: number): Promise<MetaClaim>;
  claimChest(episode: number, tier: number): Promise<MetaClaim>;
  claimStuck(): Promise<MetaClaim>;
  spin(): Promise<MetaClaim & { prize: string }>;
  friends(): Promise<FriendsView>;
  sendLife(friendId: number): Promise<{ giftsLeft: number }>;
  askLives(): Promise<{ asked: number }>;
  /** Письмо: принять жизнь / подарить в ответ / дать ключ. */
  mail(id: number): Promise<{ wallet: WalletView; lives: LivesView }>;
  levelFriends(levelId: number): Promise<{ top: LevelFriend[] }>;
  askKeys(): Promise<{ asked: number }>;
  buyGate(): Promise<{ wallet: WalletView }>;
  race(): Promise<RaceView>;
  joinRace(): Promise<RaceView>;
  raceSeen(): Promise<void>;
  season(): Promise<SeasonView>;
  claimPass(tier: number, track: 'free' | 'premium'): Promise<MetaClaim>;
  setFrame(frame: string | null): Promise<{ frame: string | null }>;
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
    meta: () => call<MetaView>('GET', '/api/meta'),
    claimLogin: () => call('POST', '/api/meta/login'),
    claimTask: (slot) => call('POST', '/api/meta/tasks', { slot }),
    claimChest: (episode, tier) => call('POST', '/api/meta/chests', { episode, tier }),
    claimStuck: () => call('POST', '/api/meta/stuck'),
    spin: () => call('POST', '/api/meta/wheel'),
    friends: () => call<FriendsView>('GET', '/api/friends'),
    sendLife: (friendId) => call('POST', `/api/friends/${friendId}/life`),
    askLives: () => call('POST', '/api/friends/ask'),
    mail: (id) => call('POST', `/api/mail/${id}`),
    levelFriends: (levelId) => call('GET', `/api/levels/${levelId}/friends`),
    askKeys: () => call('POST', '/api/gate/ask'),
    buyGate: () => call('POST', '/api/gate/buy'),
    race: () => call<RaceView>('GET', '/api/race'),
    joinRace: () => call<RaceView>('POST', '/api/race/join'),
    raceSeen: () => call<unknown>('POST', '/api/race/seen').then(() => undefined),
    season: () => call<SeasonView>('GET', '/api/season'),
    claimPass: (tier, track) => call('POST', '/api/pass/claim', { tier, track }),
    setFrame: (frame) => call('POST', '/api/frame', { frame }),
  };
}
