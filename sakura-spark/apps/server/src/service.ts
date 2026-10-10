import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { assistForLossStreak, gameOptionsFromLevel, Match3Game } from '@sakura/core';
import type { LevelDef, Move, Pos } from '@sakura/core';
import type { TelegramUser } from './auth.ts';
import { canPlay, fullLives, LIFE_REGEN_MS, MAX_LIVES, refund, regen, spend, view } from './lives.ts';
import type { LivesView } from './lives.ts';
import type { AttemptRow, LevelProgress, RoomMode, RoomRow, Store, UserRow, Wallet, WalletUpdate } from './store.ts';
import { DEFAULT_ECONOMY, extendPrice, GAME_ITEMS, isItem, ITEMS, START_ITEMS } from './economy.ts';
import type { Economy, Item, ProductId } from './economy.ts';
import { ConfigError, levelForAttempt, lossStreakForAssist, parseRemoteConfig, resolveConfig, tweakLevel } from './remote.ts';
import type { Effective, RemoteConfig } from './remote.ts';
import {
  addCard, CALENDAR, calendarReward, CHEST_TIERS, CHESTS, dayNumber, episodeOf, grant, LEVELS_PER_EPISODE, progressTasks,
  todayTasks, WHEEL, wheelPrize,
} from './meta.ts';
import type { ChestTier, MetaState, Reward, TaskKind, TaskState } from './meta.ts';

/** События, которые может прислать клиент. Игровые итоги пишет только сервер — по реплею. */
export const CLIENT_EVENTS: ReadonlySet<string> = new Set([
  'session_start', 'session_end', 'hint_shown', 'tutorial_complete',
  // PRD: конверсия окна «+5 ходов» по уровням — показы считает клиент, покупки — сервер
  'moves_offer_shown', 'shop_opened',
]);
const MAX_CLIENT_EVENTS = 20;
const MAX_PROPS_BYTES = 1024;

/** Средний прогресс целей 0..1 — для level_fail и «почти побед». */
function goalProgress(game: Match3Game): number {
  const goals = game.goalProgress();
  if (goals.length === 0) return 0;
  return goals.reduce((sum, g) => sum + (g.target > 0 ? Math.min(1, g.current / g.target) : 1), 0) / goals.length;
}

/** Запас на сеть и анимации при проверке уровня на время. */
export const TIME_GRACE_MS = 15_000;
export const MAX_SWAPS = 600;

/** Чат-режимы (PRD, «Игра в любом чате»). */
export const ROOM_TTL_MS = 24 * 3600_000;
/** PRD: «лимит 5 карточек в день» против спама в чатах. */
export const MAX_ROOM_CARDS_PER_DAY = 5;
/** PRD: «Помощь жизнью — до 5 подарков». */
export const MAX_GIFTS = 5;
/** Ход в рейтинговой комнате не может быть быстрее анимаций: быстрее — значит скрипт. */
export const MIN_MS_PER_MOVE = 250;
export const ROOM_TOP = 5;

/** Короткий id комнаты для ссылок startapp/start: «r» + 10 символов base62. */
function newRoomId(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return `r${[...randomBytes(10)].map((b) => abc[b % abc.length]).join('')}`;
}

export interface RoomView {
  readonly id: string;
  readonly mode: RoomMode;
  readonly levelId: number;
  readonly creatorName: string;
  readonly expiresAt: number;
  readonly expired: boolean;
  readonly players: number;
  readonly top: { readonly place: number; readonly name: string; readonly score: number; readonly stars: number; readonly boosted: boolean }[];
  readonly me: { readonly place: number | null; readonly bestScore: number | null; readonly attempts: number };
  /** PRD: первая попытка в челлендже бесплатна, каждая следующая стоит жизнь. */
  readonly nextAttemptFree: boolean;
  readonly gifts: number;
  readonly maxGifts: number;
  readonly serverTime: number;
}

export class ServiceError extends Error {
  constructor(
    readonly code: 'unknown_level' | 'level_locked' | 'no_lives' | 'not_found' | 'not_open' | 'invalid_replay' | 'bad_request'
      | 'room_limit' | 'room_expired' | 'no_crystals' | 'no_items' | 'not_available' | 'already' | 'not_done' | 'limit'
      | 'episode_locked' | 'not_friends' | 'lives_full',
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface WalletView {
  readonly crystals: number;
  readonly items: Readonly<Record<Item, number>>;
  readonly piggy: number;
  /** Стартовый пак доступен до этого момента; null — нет. */
  readonly starterUntil: number | null;
}

export interface MeResponse {
  readonly user: { readonly id: number; readonly firstName: string };
  readonly lives: LivesView;
  readonly wallet: WalletView;
  readonly maxLevel: number;
  readonly levels: Record<number, { readonly stars: number; readonly bestScore: number }>;
  readonly levelCount: number;
  readonly serverTime: number;
  /** Закрытые ворота района, у которых стоит игрок. */
  readonly gate: GateView | null;
  /** Ходы и время уровней, сдвинутые remote config. */
  readonly levelOverrides: Record<number, { readonly moves?: number; readonly timeLimit?: number }>;
}

export interface StartResponse {
  readonly attemptId: string;
  readonly seed: number;
  readonly level: LevelDef;
  readonly lives: LivesView;
  readonly roomId?: string;
  readonly wallet: WalletView;
  /**
   * Всё, что влияет на партию, кроме ходов: клиент обязан собрать ту же партию, что сервер проиграет
   * в реплее. assist — скрытое облегчение: в интерфейсе не показывается, но без него раскладки разойдутся.
   */
  readonly assist: number;
  readonly startBoosters: readonly Item[];
}

export interface FinishResponse {
  /** Победа привела к воротам нового района. */
  readonly gate?: GateView;
  readonly result: 'won' | 'lost';
  readonly score: number;
  readonly stars: number;
  readonly bestScore: number;
  readonly lives: LivesView;
  readonly maxLevel: number;
  /** Для попытки в комнате: место в рейтинге чата. */
  readonly room?: { readonly id: string; readonly place: number; readonly players: number };
  readonly wallet: WalletView;
}

export interface ServiceDeps {
  readonly store: Store;
  readonly levels: ReadonlyMap<number, LevelDef>;
  readonly now?: () => number;
  readonly newSeed?: () => number;
  readonly newId?: () => string;
  readonly newRoomId?: () => string;
  /** Рейтинг или подарки комнаты изменились — бот обновит карточку в чате. */
  readonly onRoomChanged?: (roomId: string) => void;
  /** Базовая экономика; remote config накладывается поверх. */
  readonly economy?: Economy;
  readonly log?: (msg: string) => void;
  /** Случайность колеса (в тестах — подменяется). */
  readonly random?: () => number;
  /** Отправить пуш в личку от бота (лимит в день сервис уже проверил). false — не дошёл. */
  readonly sendPush?: (userId: number, text: string) => Promise<boolean>;
}

const emptyProgress = (levelId: number): LevelProgress => ({ levelId, bestScore: 0, stars: 0, wins: 0, losses: 0, lossStreak: 0 });

/**
 * Правила мета-игры на сервере. Клиенту не доверяем: он присылает только ходы,
 * счёт и звёзды сервер получает, проигрывая партию тем же ядром с тем же сидом.
 */
export class GameService {
  private readonly store: Store;
  private readonly levels: ReadonlyMap<number, LevelDef>;
  private readonly now: () => number;
  private readonly newSeed: () => number;
  private readonly newId: () => string;
  private readonly newRoomId: () => string;
  private readonly onRoomChanged: (roomId: string) => void;
  readonly economy: Economy;
  private readonly log: (msg: string) => void;
  private readonly random: () => number;
  private readonly sendPush: (userId: number, text: string) => Promise<boolean>;
  /** Действующий remote config (кеш; сервер один, правки идут через setConfig). */
  private config: RemoteConfig | null = null;

  constructor(deps: ServiceDeps) {
    this.store = deps.store;
    this.levels = deps.levels;
    this.now = deps.now ?? Date.now;
    this.newSeed = deps.newSeed ?? (() => randomInt(2 ** 31));
    this.newId = deps.newId ?? randomUUID;
    this.newRoomId = deps.newRoomId ?? newRoomId;
    this.onRoomChanged = deps.onRoomChanged ?? (() => {});
    this.economy = deps.economy ?? DEFAULT_ECONOMY;
    this.log = deps.log ?? (() => {});
    this.random = deps.random ?? (() => randomInt(2 ** 32) / 2 ** 32);
    this.sendPush = deps.sendPush ?? (async () => false);
  }

  // ---------- remote config ----------

  private levelIds(): Set<number> {
    return new Set(this.levels.keys());
  }

  async remoteConfig(): Promise<RemoteConfig> {
    if (this.config) return this.config;
    const row = await this.store.getConfig();
    try {
      this.config = row ? parseRemoteConfig(JSON.parse(row.json), this.levelIds()) : {};
    } catch (e) {
      // например, из игры убрали уровень, а сдвиг для него остался — работаем на базовых значениях
      this.log(`remote config #${row?.id} ignored: ${(e as Error).message}`);
      this.config = {};
    }
    return this.config;
  }

  /** Конфиг для игрока: экономика, сдвиги уровней, порог облегчения, варианты экспериментов. */
  async configFor(userId: number): Promise<Effective> {
    return resolveConfig(await this.remoteConfig(), userId, this.economy);
  }

  /** Заменить конфиг целиком (команда администратора). Ошибка разбора — ConfigError с путём к полю. */
  async setConfig(json: string, authorId: number | null): Promise<{ id: number; config: RemoteConfig }> {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new ConfigError('это не JSON');
    }
    const config = parseRemoteConfig(raw, this.levelIds());
    const row = await this.store.saveConfig(JSON.stringify(config), this.now(), authorId);
    this.config = config;
    return { id: row.id, config };
  }

  /** Вернуть предыдущую версию конфига (новой записью — история не теряется). */
  async rollbackConfig(authorId: number | null): Promise<{ id: number; from: number } | null> {
    const [, prev] = await this.store.configHistory(2);
    if (!prev) return null;
    const row = await this.store.saveConfig(prev.json, this.now(), authorId);
    this.config = null;
    await this.remoteConfig();
    return { id: row.id, from: prev.id };
  }

  async configHistory(limit = 5) {
    return this.store.configHistory(limit);
  }

  /** Сдвиги ходов и времени для карты и экрана старта — клиент показывает то, что будет в партии. */
  private levelOverrides(eff: Effective): Record<number, { moves?: number; timeLimit?: number }> {
    const out: Record<number, { moves?: number; timeLimit?: number }> = {};
    for (const id of Object.keys(eff.levels)) {
      const level = this.levels.get(Number(id));
      if (!level) continue;
      const t = tweakLevel(level, eff.levels[id]);
      if (t.moves === null && t.timeLimit === null) continue;
      out[level.id] = { ...(t.moves !== null ? { moves: t.moves } : {}), ...(t.timeLimit !== null ? { timeLimit: t.timeLimit } : {}) };
    }
    return out;
  }

  private walletView(w: Wallet): WalletView {
    const now = this.now();
    return {
      crystals: w.crystals, items: w.items, piggy: w.piggy,
      starterUntil: !w.starterBought && w.starterUntil > now ? w.starterUntil : null,
    };
  }

  async wallet(userId: number): Promise<WalletView> {
    return this.walletView(await this.store.getWallet(userId));
  }

  /** startParam — из initData (startapp) или /start бота: «fr<id>» — пришёл по приглашению друга. */
  async login(u: TelegramUser, opts: { startParam?: string } = {}): Promise<UserRow> {
    const existed = await this.store.getUser(u.id);
    const user = await this.store.upsertUser(u, this.now(), fullLives(this.now()));
    if (!existed) {
      // PRD: бесплатные бустеры на старте — приучают ими пользоваться
      const n = (await this.configFor(u.id)).economy.freeItemsOnInstall;
      await this.store.transact(u.id, () => ({ items: Object.fromEntries(ITEMS.map((i) => [i, n])) as Record<Item, number> }));
      await this.track(u.id, 'install', null, { language: u.languageCode ?? null });
      const ref = /^fr(\d{1,15})$/.exec(opts.startParam ?? '');
      if (ref) await this.referred(user, Number(ref[1]));
    }
    return user;
  }

  // ---------- соц: друзья, жизни, ключи районов, рефералы, пуши ----------

  private async social(userId: number) {
    return (await this.configFor(userId)).economy.social;
  }

  private async today(userId: number): Promise<number> {
    return dayNumber(this.now(), (await this.configFor(userId)).economy.meta.dayOffsetHours);
  }

  /** Пуш от бота: не больше pushesPerDay в день, только тем, кто разрешил писать и не выключил уведомления. */
  async push(userId: number, text: string): Promise<boolean> {
    const limit = (await this.social(userId)).pushesPerDay;
    if (!(await this.store.reservePush(userId, await this.today(userId), limit))) return false;
    const ok = await this.sendPush(userId, text).catch(() => false);
    if (ok) await this.track(userId, 'push_sent', null, { text: text.slice(0, 60) });
    return ok;
  }

  /** Бот не смог написать (игрок заблокировал бота) — больше не пытаемся. */
  async pushBlocked(userId: number): Promise<void> {
    await this.store.setAllowsPm(userId, false);
  }

  async setNotify(userId: number, on: boolean): Promise<void> {
    await this.store.setNotify(userId, on);
  }

  private async referred(user: UserRow, referrerId: number): Promise<void> {
    const referrer = await this.store.getUser(referrerId);
    if (!referrer || referrerId === user.id || !(await this.store.setReferrer(user.id, referrerId))) return;
    await this.store.addFriends(user.id, referrerId, 'ref', this.now());
    await this.track(user.id, 'referral', null, { referrerId });
    const s = await this.social(referrerId);
    void this.push(referrerId, `${user.firstName || 'Друг'} пришёл по твоему приглашению! Когда дойдёт до уровня ${s.referralLevel} — получишь ${s.referralCrystals} 💎`);
  }

  /** Друзья — те, кто играл в одном челлендже, дарил жизнь в чате или пришёл по приглашению. */
  async befriend(a: number, b: number, source: string): Promise<void> {
    if (await this.store.addFriends(a, b, source, this.now())) await this.track(a, 'friend_added', null, { friendId: b, source });
  }

  async friendsView(userId: number) {
    const s = await this.social(userId);
    const day = await this.today(userId);
    const sent = await this.store.sentMail(userId, day, 'life');
    const asked = await this.store.sentMail(userId, day, 'ask_life');
    const friends = await this.store.getFriends(userId, 100);
    return {
      friends: friends.map((f) => ({ id: f.id, name: f.firstName, maxLevel: f.maxLevel, sentToday: sent.includes(f.id) })),
      giftsLeft: Math.max(0, s.giftsPerDay - sent.length),
      askedToday: asked.length > 0,
      inbox: (await this.store.inbox(userId, 30)).map((m) => ({ id: m.id, kind: m.kind, from: { id: m.fromId, name: m.fromName }, episode: m.episode, createdAt: m.createdAt })),
    };
  }

  /** Подарить жизнь другу: до giftsPerDay в день, одному другу — одну. Дарителю жизнь не стоит. */
  async sendLife(userId: number, friendId: unknown): Promise<{ giftsLeft: number }> {
    if (!Number.isSafeInteger(friendId)) throw new ServiceError('bad_request', 400);
    const to = friendId as number;
    if (!(await this.store.areFriends(userId, to))) throw new ServiceError('not_friends', 403);
    const s = await this.social(userId);
    const day = await this.today(userId);
    const sent = await this.store.sentMail(userId, day, 'life');
    if (sent.includes(to)) throw new ServiceError('already', 409);
    if (sent.length >= s.giftsPerDay) throw new ServiceError('limit', 429, { limit: s.giftsPerDay });
    await this.store.addMail({ fromId: userId, toId: to, kind: 'life', episode: null, day, now: this.now() });
    await this.track(userId, 'life_sent', null, { to });
    const me = (await this.store.getUser(userId))!;
    void this.push(to, `${me.firstName || 'Друг'} подарил тебе жизнь ❤`);
    return { giftsLeft: s.giftsPerDay - sent.length - 1 };
  }

  /** Попросить жизнь у всех друзей — раз в день каждому. */
  async askLives(userId: number): Promise<{ asked: number }> {
    return this.askFriends(userId, 'ask_life', null, (name) => `${name} просит жизнь — подари в игре ❤`);
  }

  private async askFriends(userId: number, kind: 'ask_life' | 'ask_key', episode: number | null, text: (name: string) => string): Promise<{ asked: number }> {
    const day = await this.today(userId);
    const already = new Set(await this.store.sentMail(userId, day, kind));
    const me = (await this.store.getUser(userId))!;
    const friends = (await this.store.getFriends(userId, 100)).filter((f) => !already.has(f.id));
    for (const f of friends) {
      await this.store.addMail({ fromId: userId, toId: f.id, kind, episode, day, now: this.now() });
      void this.push(f.id, text(me.firstName || 'Друг'));
    }
    if (friends.length > 0) await this.track(userId, kind, null, { friends: friends.length, episode });
    return { asked: friends.length };
  }

  /** Письмо из «почты»: принять жизнь, подарить жизнь в ответ на просьбу, дать ключ района. */
  async mailAction(userId: number, mailId: unknown): Promise<{ wallet: WalletView; lives: LivesView }> {
    if (!Number.isSafeInteger(mailId)) throw new ServiceError('bad_request', 400);
    const m = await this.store.getMail(mailId as number);
    if (!m || m.toId !== userId) throw new ServiceError('not_found', 404);
    if (m.status !== 'new') throw new ServiceError('already', 409);
    const now = this.now();
    let w: Wallet | null;
    if (m.kind === 'life') {
      let full = false;
      w = await this.store.closeMail(m.id, 'accepted', userId, (x) => {
        const l = regen(x.lives, now);
        if (l.lives >= MAX_LIVES) {
          full = true;
          return null;
        }
        return { lives: { ...l, lives: l.lives + 1 } };
      });
      if (full) throw new ServiceError('lives_full', 409);
    } else if (m.kind === 'ask_life') {
      await this.sendLife(userId, m.fromId).catch((e) => {
        if (!(e instanceof ServiceError && e.code === 'already')) throw e;
      });
      w = await this.store.closeMail(m.id, 'done', userId, () => ({}));
    } else {
      const s = await this.social(m.fromId);
      await this.store.transact(m.fromId, (x) => {
        const g = x.meta.gates?.[String(m.episode)];
        if (!g || g.keys.includes(userId) || g.keys.length >= s.keysNeeded) return null;
        return { meta: { ...x.meta, gates: { ...x.meta.gates, [String(m.episode)]: { ...g, keys: [...g.keys, userId] } } } };
      });
      w = await this.store.closeMail(m.id, 'done', userId, () => ({}));
      await this.track(userId, 'key_given', null, { to: m.fromId, episode: m.episode });
    }
    if (!w) throw new ServiceError('already', 409);
    return { wallet: this.walletView(w), lives: view(w.lives, now) };
  }

  /** Лучшие результаты друзей на уровне (PRD «Рейтинг уровня»). */
  async levelFriends(userId: number, levelId: number) {
    return (await this.store.levelScores(userId, levelId)).slice(0, 10)
      .map((r, i) => ({ place: i + 1, name: r.firstName, score: r.score, stars: r.stars, me: r.id === userId }));
  }

  /**
   * Ворота района: игрок дошёл до первого уровня нового района — нужно 3 ключа от друзей,
   * или подождать 24 ч, или заплатить кристаллами. null — закрытых ворот нет.
   */
  private gateOf(user: UserRow, meta: MetaState, e: Economy, now: number): GateView | null {
    const episode = episodeOf(user.maxLevel);
    const first = (episode - 1) * LEVELS_PER_EPISODE + 1;
    if (episode < 2 || user.maxLevel !== first || user.maxLevel > this.levels.size) return null;
    const g = meta.gates?.[String(episode)];
    // кто стоял у ворот до появления ключей — не запираем
    if (!g) return null;
    const unlockAt = g.reachedAt + e.social.gateWaitHours * 3600_000;
    if (g.open || g.keys.length >= e.social.keysNeeded || now >= unlockAt) return null;
    return { episode, levelId: first, keys: g.keys.length, needed: e.social.keysNeeded, unlockAt, price: e.social.gatePrice };
  }

  async gate(userId: number): Promise<GateView | null> {
    const user = (await this.store.getUser(userId))!;
    return this.gateOf(user, (await this.store.getWallet(userId)).meta, (await this.configFor(userId)).economy, this.now());
  }

  async askKeys(userId: number): Promise<{ asked: number }> {
    const g = await this.gate(userId);
    if (!g) throw new ServiceError('not_available', 409);
    return this.askFriends(userId, 'ask_key', g.episode, (name) => `${name} просит ключ к новому району — помоги в игре 🔑`);
  }

  async buyGate(userId: number): Promise<{ wallet: WalletView }> {
    const g = await this.gate(userId);
    if (!g) throw new ServiceError('not_available', 409);
    const w = await this.store.transact(userId, (x) => {
      if (x.crystals < g.price) return null;
      const cur = x.meta.gates![String(g.episode)]!;
      return { crystals: x.crystals - g.price, meta: { ...x.meta, gates: { ...x.meta.gates, [String(g.episode)]: { ...cur, open: true } } } };
    });
    if (!w) throw new ServiceError('no_crystals', 402, { price: g.price });
    await this.track(userId, 'gate_bought', null, { episode: g.episode, price: g.price });
    return { wallet: this.walletView(w) };
  }

  /** Пуши «жизни восстановились» — тем, у кого они кончились. Вызывается по таймеру. */
  async pushLivesRefilled(): Promise<number> {
    let n = 0;
    for (const u of await this.store.livesRefilled(this.now(), LIFE_REGEN_MS, MAX_LIVES)) {
      await this.store.setLivesPushAt(u.id, u.fullAt);
      if (await this.push(u.id, 'Жизни восстановились — Мика ждёт на карте! ❤ ×5')) n++;
    }
    return n;
  }

  /** После победы: награда пригласившему (уровень 10), «друг обогнал тебя» тем, кого обошёл. */
  private async afterWin(user: UserRow, levelId: number, prevBest: number, score: number, newMaxLevel: number): Promise<void> {
    const s = await this.social(user.id);
    if (user.referrerId && user.maxLevel <= s.referralLevel && newMaxLevel > s.referralLevel && await this.store.markReferralRewarded(user.id)) {
      const rs = await this.social(user.referrerId);
      await this.store.transact(user.referrerId, (w) => ({ crystals: w.crystals + rs.referralCrystals }));
      await this.track(user.referrerId, 'referral_reward', null, { friendId: user.id, crystals: rs.referralCrystals });
      void this.push(user.referrerId, `${user.firstName || 'Друг'} дошёл до уровня ${rs.referralLevel} — тебе ${rs.referralCrystals} 💎!`);
    }
    if (score <= prevBest) return;
    for (const f of await this.store.levelScores(user.id, levelId)) {
      if (f.id !== user.id && f.score < score && f.score >= prevBest) void this.push(f.id, `${user.firstName || 'Друг'} обогнал тебя на уровне ${levelId}! Отыграешься?`);
    }
  }

  private track(userId: number, name: string, levelId: number | null, props: Record<string, unknown> = {}): Promise<void> {
    return this.store.addEvents([{ userId, name, ts: this.now(), levelId, props }]);
  }

  /** События от клиента: только из белого списка, не больше 20 за раз, props до 1 КБ. */
  async clientEvents(userId: number, input: unknown): Promise<number> {
    if (!Array.isArray(input) || input.length > MAX_CLIENT_EVENTS) throw new ServiceError('bad_request', 400);
    const now = this.now();
    const rows = input.flatMap((e: unknown) => {
      if (typeof e !== 'object' || e === null) return [];
      const { name, levelId, props } = e as { name?: unknown; levelId?: unknown; props?: unknown };
      if (typeof name !== 'string' || !CLIENT_EVENTS.has(name)) return [];
      const p = typeof props === 'object' && props !== null && !Array.isArray(props) ? props as Record<string, unknown> : {};
      if (JSON.stringify(p).length > MAX_PROPS_BYTES) return [];
      return [{ userId, name, ts: now, levelId: Number.isInteger(levelId) ? levelId as number : null, props: p }];
    });
    await this.store.addEvents(rows);
    return rows.length;
  }

  async me(user: UserRow): Promise<MeResponse> {
    const progress = await this.store.getProgress(user.id);
    const eff = await this.configFor(user.id);
    return {
      levelOverrides: this.levelOverrides(eff),
      gate: this.gateOf(user, (await this.store.getWallet(user.id)).meta, eff.economy, this.now()),
      user: { id: user.id, firstName: user.firstName },
      lives: view(user.lives, this.now()),
      wallet: await this.wallet(user.id),
      maxLevel: user.maxLevel,
      levels: Object.fromEntries(progress.map((p) => [p.levelId, { stars: p.stars, bestScore: p.bestScore }])),
      levelCount: this.levels.size,
      serverTime: this.now(),
    };
  }

  levelSummaries(): { id: number; difficulty: string }[] {
    return [...this.levels.values()].map((l) => ({ id: l.id, difficulty: l.difficulty }));
  }

  /** Начать попытку: проверить доступ к уровню и жизни, выдать сид, зарезервировать жизнь. */
  async startAttempt(userId: number, levelId: number, boosters: readonly unknown[] = []): Promise<StartResponse> {
    const startBoosters = parseStartBoosters(boosters);
    const level = this.levels.get(levelId);
    if (!level) throw new ServiceError('unknown_level', 404);
    let user = (await this.store.getUser(userId))!;
    if (levelId > user.maxLevel) throw new ServiceError('level_locked', 403, { maxLevel: user.maxLevel });
    if (levelId === user.maxLevel) {
      const gate = this.gateOf(user, (await this.store.getWallet(userId)).meta, (await this.configFor(userId)).economy, this.now());
      if (gate) throw new ServiceError('episode_locked', 403, { gate });
    }

    // незаконченная попытка (закрыли приложение посреди уровня) засчитывается как поражение
    const open = await this.store.getOpenAttempt(userId);
    if (open) {
      await this.closeAsLoss(open, 'abandoned', []);
      user = (await this.store.getUser(userId))!;
    }

    const now = this.now();
    if (!canPlay(user.lives, now)) {
      await this.track(userId, 'lives_empty', levelId, { nextLifeAt: view(user.lives, now).nextLifeAt });
      throw new ServiceError('no_lives', 409, { lives: view(user.lives, now) });
    }

    const progress = (await this.store.getLevelProgress(userId, levelId)) ?? emptyProgress(levelId);
    const eff = await this.configFor(userId);
    await this.takeStartBoosters(userId, startBoosters);
    const lives = spend(user.lives, now);
    const tweak = tweakLevel(level, eff.levels[String(levelId)]);
    const attempt = {
      id: this.newId(), userId, levelId, seed: this.newSeed(),
      // PRD: после 5+ поражений подряд (порог — из конфига) — скрытое облегчение
      assist: assistForLossStreak(lossStreakForAssist(progress.lossStreak, eff.assistAfterLosses)), startedAt: now, roomId: null, startBoosters,
      moves: tweak.moves, timeLimit: tweak.timeLimit,
    };
    await this.store.createAttempt(attempt, lives);
    await this.track(userId, 'level_start', levelId, {
      attemptId: attempt.id, assist: attempt.assist, boosters: startBoosters, ...expProps(eff),
      ...(tweak.moves !== null ? { moves: tweak.moves } : {}), ...(tweak.timeLimit !== null ? { timeLimit: tweak.timeLimit } : {}),
    });
    return {
      attemptId: attempt.id, seed: attempt.seed, level: levelForAttempt(level, attempt), lives: view(lives, now), wallet: await this.wallet(userId),
      assist: attempt.assist, startBoosters,
    };
  }

  /**
   * Завершить попытку. Победа возвращает зарезервированную жизнь; поражение и брошенная
   * партия её оставляют потраченной. Подделанный реплей — тоже потраченная жизнь.
   */
  async finishAttempt(userId: number, attemptId: string, swaps: unknown, timedOut: boolean): Promise<FinishResponse> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt || attempt.userId !== userId) throw new ServiceError('not_found', 404);
    if (attempt.status !== 'open') throw new ServiceError('not_open', 409, { status: attempt.status });
    const parsed = parseMoves(swaps);
    if (!parsed) {
      await this.closeAsLoss(attempt, 'rejected', [], false);
      throw new ServiceError('invalid_replay', 400);
    }
    const level = levelForAttempt(this.levels.get(attempt.levelId)!, attempt);
    let game: Match3Game;
    try {
      game = Match3Game.replay(this.optionsFor(attempt, level), parsed);
    } catch {
      await this.closeAsLoss(attempt, 'rejected', parsed, false);
      throw new ServiceError('invalid_replay', 400);
    }

    const spendingProblem = await this.settleSpending(attempt, game);
    if (spendingProblem) {
      await this.closeAsLoss(attempt, 'rejected', parsed, false);
      throw new ServiceError('invalid_replay', 400, { reason: spendingProblem });
    }
    if (attempt.roomId) return this.finishRoomAttempt(attempt, game, parsed);

    const now = this.now();
    // уровень на время идёт до конца таймера: итог решается при timeUp (клиент присылает ходы, когда время вышло)
    if (level.timeLimit !== undefined && game.status === 'playing') game.timeUp();
    let won = game.status === 'won';
    // на уровне со временем проверяем правдоподобие: победа позже лимита не засчитывается
    if (won && level.timeLimit !== undefined && now - attempt.startedAt > level.timeLimit * 1000 + TIME_GRACE_MS) won = false;
    if (!won) {
      return this.closeAsLoss(attempt, game.status === 'lost' || timedOut ? 'lost' : 'abandoned', parsed, true, game);
    }

    const user = (await this.store.getUser(userId))!;
    const prev = (await this.store.getLevelProgress(userId, level.id)) ?? emptyProgress(level.id);
    const progress: LevelProgress = {
      ...prev, bestScore: Math.max(prev.bestScore, game.score), stars: Math.max(prev.stars, game.stars),
      wins: prev.wins + 1, lossStreak: 0,
    };
    const lives = refund(user.lives, now);
    const maxLevel = Math.max(user.maxLevel, level.id + 1);
    const closed = await this.store.closeAttempt(attempt.id, userId, {
      status: 'won', finishedAt: now, score: game.score, stars: game.stars, swaps: parsed, lives, progress, maxLevel,
    });
    if (!closed) throw new ServiceError('not_open', 409);
    // копилка растёт за победы; стартовый пак открывается один раз, когда игрок прошёл уровень 15
    const e = (await this.configFor(userId)).economy;
    const crossed = user.maxLevel <= e.starter.afterLevel && maxLevel > e.starter.afterLevel;
    const day = dayNumber(now, e.meta.dayOffsetHours);
    await this.store.transact(userId, (w) => {
      const meta = progressTasks(w.meta, userId, day, { win: 1, stars: game.stars, threeStars: game.stars === 3 ? 1 : 0, score: game.score });
      return {
        piggy: Math.min(e.piggy.max, w.piggy + e.piggy.perWin),
        ...(crossed && !w.starterBought && w.starterUntil === 0 ? { starterUntil: now + e.starter.windowMs } : {}),
        // защита от выгорания считает дни с открытия последнего уровня
        meta: maxLevel > user.maxLevel ? { ...withGate(meta, maxLevel, now, this.levels.size), maxLevelAt: now } : meta,
      };
    });
    await this.track(userId, 'level_win', level.id, {
      attemptId: attempt.id, score: game.score, stars: game.stars, movesUsed: parsed.length,
      movesLeft: level.timeLimit === undefined ? game.movesLeft : null, assist: attempt.assist,
    });
    await this.afterWin(user, level.id, prev.bestScore, game.score, maxLevel);
    const gate = maxLevel > user.maxLevel ? await this.gate(userId) : null;
    return {
      result: 'won', score: game.score, stars: game.stars, bestScore: progress.bestScore, lives: view(lives, now), maxLevel,
      wallet: await this.wallet(userId), ...(gate ? { gate } : {}),
    };
  }

  // ---------- чат-режимы ----------

  /** Создать комнату: челлендж (общий уровень и сид на 24 ч) или просьбу о жизни. Лимит 5 карточек в день. */
  async createRoom(userId: number, mode: RoomMode): Promise<RoomRow> {
    const user = (await this.store.getUser(userId))!;
    const now = this.now();
    if (await this.store.countActiveRooms(userId, now - 24 * 3600_000) >= MAX_ROOM_CARDS_PER_DAY) {
      throw new ServiceError('room_limit', 429, { limit: MAX_ROOM_CARDS_PER_DAY });
    }
    await this.store.pruneRooms(now);
    const seed = this.newSeed();
    const pool = roomLevelPool(this.levels, user.maxLevel);
    const room: RoomRow = {
      id: this.newRoomId(), mode, creatorId: userId, creatorName: user.firstName,
      levelId: mode === 'challenge' ? pool[seed % pool.length] ?? 1 : 1, seed,
      createdAt: now, expiresAt: now + ROOM_TTL_MS, inlineMessageId: null, gifts: 0,
    };
    await this.store.createRoom(room);
    await this.track(userId, 'room_create', room.levelId, { roomId: room.id, mode });
    return room;
  }

  getRoom(id: string): Promise<RoomRow | null> {
    return this.store.getRoom(id);
  }

  async setRoomMessage(roomId: string, inlineMessageId: string): Promise<void> {
    await this.store.setRoomMessage(roomId, inlineMessageId);
  }

  async roomView(roomId: string, userId: number | null): Promise<RoomView> {
    const room = await this.store.getRoom(roomId);
    if (!room) throw new ServiceError('not_found', 404);
    const results = await this.store.getRoomResults(roomId);
    const now = this.now();
    const mine = userId === null ? -1 : results.findIndex((r) => r.userId === userId);
    const attempts = userId === null ? 0 : await this.store.countRoomAttempts(roomId, userId);
    return {
      id: room.id, mode: room.mode, levelId: room.levelId, creatorName: room.creatorName,
      expiresAt: room.expiresAt, expired: now >= room.expiresAt, players: results.length,
      top: results.slice(0, ROOM_TOP).map((r, i) => ({ place: i + 1, name: r.firstName, score: r.bestScore, stars: r.stars, boosted: r.boosted })),
      me: { place: mine >= 0 ? mine + 1 : null, bestScore: mine >= 0 ? results[mine]!.bestScore : null, attempts },
      nextAttemptFree: attempts === 0, gifts: room.gifts, maxGifts: MAX_GIFTS, serverTime: now,
    };
  }

  /** Попытка в челлендже: тот же уровень и сид, что у всех; первая бесплатна, дальше — жизнь. */
  async startRoomAttempt(userId: number, roomId: string, boosters: readonly unknown[] = []): Promise<StartResponse> {
    const startBoosters = parseStartBoosters(boosters);
    const room = await this.store.getRoom(roomId);
    if (!room || room.mode !== 'challenge') throw new ServiceError('not_found', 404);
    const now = this.now();
    if (now >= room.expiresAt) throw new ServiceError('room_expired', 410);
    const open = await this.store.getOpenAttempt(userId);
    if (open) await this.closeAsLoss(open, 'abandoned', []);
    const user = (await this.store.getUser(userId))!;
    const free = (await this.store.countRoomAttempts(roomId, userId)) === 0;
    if (!free && !canPlay(user.lives, now)) {
      await this.track(userId, 'lives_empty', room.levelId, { roomId, nextLifeAt: view(user.lives, now).nextLifeAt });
      throw new ServiceError('no_lives', 409, { lives: view(user.lives, now) });
    }
    await this.takeStartBoosters(userId, startBoosters);
    const lives = free ? user.lives : spend(user.lives, now);
    // облегчение в комнате не даём: у всех должно быть одинаковое выпадение фишек
    const attempt = {
      id: this.newId(), userId, levelId: room.levelId, seed: room.seed, assist: 0, startedAt: now, roomId, startBoosters, moves: null, timeLimit: null,
    };
    await this.store.createAttempt(attempt, lives);
    await this.track(userId, 'room_start', room.levelId, { roomId, attemptId: attempt.id, free });
    return {
      attemptId: attempt.id, seed: room.seed, level: this.levels.get(room.levelId)!, lives: view(lives, now), roomId,
      wallet: await this.wallet(userId), assist: 0, startBoosters,
    };
  }

  private async finishRoomAttempt(attempt: AttemptRow, game: Match3Game, swaps: readonly Move[]): Promise<FinishResponse> {
    const now = this.now();
    // рейтинг честный: ходы быстрее анимаций — скрипт, результат не засчитываем
    if (swaps.length > 0 && now - attempt.startedAt < swaps.length * MIN_MS_PER_MOVE) {
      await this.closeAsLoss(attempt, 'rejected', swaps, false);
      throw new ServiceError('invalid_replay', 400, { reason: 'too_fast' });
    }
    const user = (await this.store.getUser(attempt.userId))!;
    const won = game.status === 'won';
    const used = game.boostersUsed();
    const boosted = attempt.startBoosters.length > 0 || used.hammer + used.freeSwap + used.shuffle > 0 || attempt.extensions > 0;
    await this.store.recordRoomResult(attempt.roomId!, {
      userId: user.id, firstName: user.firstName, bestScore: game.score, stars: game.stars, won, boosted,
    }, now);
    await this.store.closeAttempt(attempt.id, user.id, {
      status: won ? 'won' : 'lost', finishedAt: now, score: game.score, stars: game.stars, swaps,
      lives: user.lives, progress: null, maxLevel: user.maxLevel,
    });
    await this.track(user.id, 'room_finish', attempt.levelId, {
      roomId: attempt.roomId, attemptId: attempt.id, score: game.score, stars: game.stars, won, movesLeft: game.movesLeft,
    });
    await this.bumpTasks(user.id, { room: 1, score: game.score });
    const room = await this.store.getRoom(attempt.roomId!);
    if (room && room.creatorId !== user.id) await this.befriend(user.id, room.creatorId, 'room');
    const results = await this.store.getRoomResults(attempt.roomId!);
    const place = results.findIndex((r) => r.userId === user.id) + 1;
    this.onRoomChanged(attempt.roomId!);
    return {
      result: won ? 'won' : 'lost', score: game.score, stars: game.stars, bestScore: results[place - 1]?.bestScore ?? game.score,
      lives: view(user.lives, now), maxLevel: user.maxLevel, room: { id: attempt.roomId!, place, players: results.length },
      wallet: await this.wallet(user.id),
    };
  }

  /** «Подарить жизнь» в карточке просьбы: +1 жизнь просящему, каждый дарит один раз, до 5 подарков. */
  async giftLife(roomId: string, giver: TelegramUser): Promise<{ status: 'ok' | 'already' | 'full' | 'own' | 'expired' | 'not_found'; gifts: number }> {
    const room = await this.store.getRoom(roomId);
    if (!room || room.mode !== 'help') return { status: 'not_found', gifts: 0 };
    const now = this.now();
    if (now >= room.expiresAt) return { status: 'expired', gifts: room.gifts };
    if (giver.id === room.creatorId) return { status: 'own', gifts: room.gifts };
    await this.login(giver);
    const status = await this.store.addGift(roomId, giver.id, now, MAX_GIFTS, (l) => refund(l, now));
    const gifts = (await this.store.getRoom(roomId))!.gifts;
    if (status === 'ok') {
      await this.track(giver.id, 'life_gift', null, { roomId, to: room.creatorId });
      await this.befriend(giver.id, room.creatorId, 'gift');
      this.onRoomChanged(roomId);
    }
    return { status, gifts };
  }

  private optionsFor(a: AttemptRow, level: LevelDef) {
    const opts = gameOptionsFromLevel(level, a.seed);
    const sb = a.startBoosters;
    return {
      ...opts,
      ...(a.assist > 0 ? { assist: a.assist } : {}),
      ...(sb.length > 0 ? { startBoosters: { beamBomb: sb.includes('beamBomb'), rainbow: sb.includes('rainbow'), extraMoves: sb.includes('extraMoves') } } : {}),
    };
  }

  /** Бустеры перед уровнем списываются при старте — даже если партия будет проиграна. */
  private async takeStartBoosters(userId: number, items: readonly Item[]): Promise<void> {
    if (items.length === 0) return;
    const ok = await this.store.transact(userId, (w) => {
      if (items.some((i) => w.items[i] < 1)) return null;
      return { items: Object.fromEntries(items.map((i) => [i, w.items[i] - 1])) };
    });
    if (!ok) throw new ServiceError('no_items', 409, { items });
    await this.track(userId, 'booster_used', null, { items, when: 'start' });
    await this.bumpTasks(userId, { booster: items.length });
  }

  /**
   * Проверка трат по реплею: «+5 ходов» не больше оплаченных, бустеры во время игры — со склада
   * (списываются здесь). null — всё в порядке, иначе причина отказа.
   */
  private async settleSpending(attempt: AttemptRow, game: Match3Game): Promise<string | null> {
    const extras = game.history.filter((m) => 'extraMoves' in m) as { extraMoves: number }[];
    const { extendMoves } = (await this.configFor(attempt.userId)).economy;
    if (extras.length > attempt.extensions || extras.some((m) => m.extraMoves !== extendMoves)) return 'unpaid_moves';
    const used = game.boostersUsed();
    const spent = (Object.entries(used) as [Item, number][]).filter(([, n]) => n > 0);
    if (spent.length === 0) return null;
    const ok = await this.store.transact(attempt.userId, (w) => {
      if (spent.some(([i, n]) => w.items[i] < n)) return null;
      return { items: Object.fromEntries(spent.map(([i, n]) => [i, w.items[i] - n])) };
    });
    if (!ok) return 'no_boosters';
    await this.track(attempt.userId, 'booster_used', attempt.levelId, { used, when: 'game', attemptId: attempt.id });
    await this.bumpTasks(attempt.userId, { booster: spent.reduce((s, [, n]) => s + n, 0) });
    return null;
  }

  /**
   * «+5 ходов» (PRD): ходы кончились, цели не выполнены — докупить за кристаллы по растущей цене 9 → 15 → 25.
   * Сервер проигрывает ходы до этого момента и проверяет, что партия действительно проиграна по ходам.
   */
  async extendAttempt(userId: number, attemptId: string, input: unknown): Promise<{ price: number; extensions: number; wallet: WalletView }> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt || attempt.userId !== userId) throw new ServiceError('not_found', 404);
    if (attempt.status !== 'open') throw new ServiceError('not_open', 409);
    const moves = parseMoves(input);
    const level = levelForAttempt(this.levels.get(attempt.levelId)!, attempt);
    if (!moves || level.timeLimit !== undefined) throw new ServiceError('bad_request', 400);
    let game: Match3Game;
    try {
      game = Match3Game.replay(this.optionsFor(attempt, level), moves);
    } catch {
      throw new ServiceError('invalid_replay', 400);
    }
    const bought = moves.filter((m) => 'extraMoves' in m).length;
    if (game.status !== 'lost' || game.movesLeft !== 0 || bought !== attempt.extensions) throw new ServiceError('bad_request', 400);
    const economy = (await this.configFor(userId)).economy;
    const r = await this.store.extendAttempt(attemptId, userId, (n) => extendPrice(economy, n));
    if (r.status === 'not_open') throw new ServiceError('not_open', 409);
    if (r.status === 'no_crystals') throw new ServiceError('no_crystals', 402, { price: r.price });
    await this.track(userId, 'moves_purchased', attempt.levelId, {
      attemptId, price: r.price, n: attempt.extensions + 1, goalProgress: Math.round(goalProgress(game) * 100) / 100,
    });
    return { price: r.price, extensions: attempt.extensions + 1, wallet: this.walletView(r.wallet!) };
  }

  // ---------- мета: задания, календарь, колесо, сундуки, помощь застрявшему ----------

  private async bumpTasks(userId: number, deltas: Partial<Record<TaskKind, number>>): Promise<void> {
    const day = dayNumber(this.now(), (await this.configFor(userId)).economy.meta.dayOffsetHours);
    await this.store.transact(userId, (w) => ({ meta: progressTasks(w.meta, userId, day, deltas) }));
  }

  /** Звёзды по эпизодам (лучшие по каждому уровню). */
  private async episodeStars(userId: number): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    for (const p of await this.store.getProgress(userId)) out.set(episodeOf(p.levelId), (out.get(episodeOf(p.levelId)) ?? 0) + p.stars);
    return out;
  }

  private isStuck(meta: MetaState, maxLevel: number, e: Economy, now: number): boolean {
    return meta.maxLevelAt !== undefined && now - meta.maxLevelAt >= e.meta.stuckDays * 86_400_000
      && meta.stuckGift !== maxLevel && maxLevel <= this.levels.size;
  }

  async metaView(userId: number): Promise<MetaView> {
    const e = (await this.configFor(userId)).economy;
    const now = this.now();
    const day = dayNumber(now, e.meta.dayOffsetHours);
    let w = await this.store.getWallet(userId);
    const user = (await this.store.getUser(userId))!;
    if (w.meta.maxLevelAt === undefined) {
      // игроки до этапа меты: дни застревания считаем с первого открытия экрана
      w = (await this.store.transact(userId, (x) => ({ meta: { ...x.meta, maxLevelAt: now } })))!;
    }
    const m = w.meta;
    const count = m.loginCount ?? 0;
    const claimedToday = m.loginDay === day;
    // показываем текущую неделю календаря: 7 наград, позиция — сколько из них уже получено
    const weekStart = Math.floor((claimedToday ? count - 1 : count) / 7) * 7;
    const stars = await this.episodeStars(userId);
    const spins = m.wheelDay === day ? m.wheelSpins ?? 0 : 0;
    return {
      day, nextDayAt: (day + 1) * 86_400_000 - e.meta.dayOffsetHours * 3600_000,
      login: {
        count, claimedToday, position: count - weekStart,
        rewards: CALENDAR.map((_, i) => calendarReward(weekStart + i + 1, m.cards ?? {})),
      },
      tasks: todayTasks(m, userId, day),
      chests: [...Array(Math.min(episodeOf(user.maxLevel), Math.ceil(this.levels.size / LEVELS_PER_EPISODE))).keys()].map((i) => {
        const episode = i + 1;
        const s = stars.get(episode) ?? 0;
        return {
          episode, stars: s,
          tiers: CHEST_TIERS.map((tier) => ({ tier, reward: CHESTS[tier], claimed: (m.chests ?? []).includes(`${episode}:${tier}`), available: s >= tier })),
        };
      }),
      wheel: {
        free: spins === 0, extraLeft: Math.max(0, e.meta.wheelExtraSpins - Math.max(0, spins - 1)), price: e.meta.wheelSpinPrice,
        prizes: WHEEL.map((p) => ({ id: p.id, weight: p.weight, reward: p.reward })),
      },
      cards: m.cards ?? {},
      stuck: this.isStuck(m, user.maxLevel, e, now) ? { levelId: user.maxLevel, reward: STUCK_REWARD } : null,
    };
  }

  /**
   * Выдать награду меты одной транзакцией: check решает по кошельку, можно ли (null — нельзя),
   * и возвращает награду и новое состояние меты.
   */
  private async claim(userId: number, check: (w: Wallet) => { reward: Reward; meta: MetaState; cost?: number } | ServiceError): Promise<MetaClaim> {
    const now = this.now();
    let reward: Reward | null = null;
    let error: ServiceError | null = null;
    const w = await this.store.transact(userId, (x) => {
      const r = check(x);
      if (r instanceof ServiceError) {
        error = r;
        return null;
      }
      reward = r.reward;
      const g = grant(r.cost ? { ...x, crystals: x.crystals - r.cost } : x, r.reward, now);
      return { ...(r.cost ? { crystals: x.crystals - r.cost } : {}), ...g, meta: addCard(r.meta, r.reward) };
    });
    if (error) throw error;
    return { reward: reward!, wallet: this.walletView(w!), lives: view(w!.lives, now), meta: await this.metaView(userId) };
  }

  /** Календарь входа: одна награда в игровой день; пропуск дня цикл не сбрасывает. */
  async claimLogin(userId: number): Promise<MetaClaim> {
    const e = (await this.configFor(userId)).economy;
    const day = dayNumber(this.now(), e.meta.dayOffsetHours);
    const r = await this.claim(userId, (w) => {
      if (w.meta.loginDay === day) return new ServiceError('already', 409);
      const n = (w.meta.loginCount ?? 0) + 1;
      return { reward: calendarReward(n, w.meta.cards ?? {}), meta: { ...w.meta, loginDay: day, loginCount: n } };
    });
    await this.track(userId, 'login_reward', null, { n: r.meta.login.count, reward: r.reward });
    return r;
  }

  async claimTask(userId: number, slot: unknown): Promise<MetaClaim> {
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 2) throw new ServiceError('bad_request', 400);
    const i = slot as number;
    const e = (await this.configFor(userId)).economy;
    const day = dayNumber(this.now(), e.meta.dayOffsetHours);
    let kind: TaskKind | null = null;
    const r = await this.claim(userId, (w) => {
      const tasks = todayTasks(w.meta, userId, day);
      const t = tasks[i]!;
      if (t.claimed) return new ServiceError('already', 409);
      if (t.progress < t.target) return new ServiceError('not_done', 409);
      kind = t.kind;
      return { reward: t.reward, meta: { ...w.meta, taskDay: day, tasks: tasks.map((x, j) => (j === i ? { ...x, claimed: true } : x)) } };
    });
    await this.track(userId, 'task_claimed', null, { kind, slot: i });
    return r;
  }

  async claimChest(userId: number, episode: unknown, tier: unknown): Promise<MetaClaim> {
    if (!Number.isInteger(episode) || !(CHEST_TIERS as readonly unknown[]).includes(tier)) throw new ServiceError('bad_request', 400);
    const stars = (await this.episodeStars(userId)).get(episode as number) ?? 0;
    const key = `${episode}:${tier}`;
    const r = await this.claim(userId, (w) => {
      if ((w.meta.chests ?? []).includes(key)) return new ServiceError('already', 409);
      if (stars < (tier as number)) return new ServiceError('not_done', 409, { stars });
      return { reward: CHESTS[tier as ChestTier], meta: { ...w.meta, chests: [...(w.meta.chests ?? []), key] } };
    });
    await this.track(userId, 'chest_opened', null, { episode, tier });
    return r;
  }

  /** Колесо: первый спин дня бесплатный, ещё несколько — за кристаллы. Вероятности открыты (WHEEL). */
  async spinWheel(userId: number): Promise<MetaClaim & { prize: string }> {
    const e = (await this.configFor(userId)).economy;
    const day = dayNumber(this.now(), e.meta.dayOffsetHours);
    const prize = WHEEL[wheelPrize(this.random())]!;
    let paid = 0;
    const r = await this.claim(userId, (w) => {
      const spins = w.meta.wheelDay === day ? w.meta.wheelSpins ?? 0 : 0;
      if (spins > 0) {
        if (spins - 1 >= e.meta.wheelExtraSpins) return new ServiceError('limit', 409);
        if (w.crystals < e.meta.wheelSpinPrice) return new ServiceError('no_crystals', 402, { price: e.meta.wheelSpinPrice });
        paid = e.meta.wheelSpinPrice;
      }
      return { reward: prize.reward, meta: { ...w.meta, wheelDay: day, wheelSpins: spins + 1 }, cost: paid };
    });
    await this.track(userId, 'wheel_spin', null, { prize: prize.id, paid });
    return { ...r, prize: prize.id };
  }

  /** PRD «Защита от выгорания»: застрял на уровне 3+ дня — бесплатный бустер, один раз на уровень. */
  async claimStuck(userId: number): Promise<MetaClaim> {
    const e = (await this.configFor(userId)).economy;
    const user = (await this.store.getUser(userId))!;
    const now = this.now();
    const r = await this.claim(userId, (w) => {
      if (!this.isStuck(w.meta, user.maxLevel, e, now)) return new ServiceError('not_available', 409);
      return { reward: STUCK_REWARD, meta: { ...w.meta, stuckGift: user.maxLevel } };
    });
    await this.track(userId, 'stuck_gift', user.maxLevel, {});
    return r;
  }

  // ---------- магазин ----------

  /** Купить бустер за кристаллы (на экране старта уровня или прямо во время игры). */
  async buyItem(userId: number, item: unknown, count: unknown = 1): Promise<WalletView> {
    if (!isItem(item) || !Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) throw new ServiceError('bad_request', 400);
    const n = count as number;
    const price = (await this.configFor(userId)).economy.itemPrices[item] * n;
    const w = await this.store.transact(userId, (x) => (x.crystals < price ? null : { crystals: x.crystals - price, items: { [item]: x.items[item] + n } }));
    if (!w) throw new ServiceError('no_crystals', 402, { price });
    await this.track(userId, 'item_bought', null, { item, n, price });
    return this.walletView(w);
  }

  /** Полный запас жизней за кристаллы. */
  async refillLives(userId: number): Promise<{ lives: LivesView; wallet: WalletView }> {
    const now = this.now();
    const price = (await this.configFor(userId)).economy.refillLives;
    let full = false;
    const w = await this.store.transact(userId, (x) => {
      if (view(x.lives, now).lives >= MAX_LIVES_VIEW) {
        full = true;
        return null;
      }
      return x.crystals < price ? null : { crystals: x.crystals - price, lives: { ...x.lives, lives: MAX_LIVES_VIEW, updatedAt: now } };
    });
    if (full) throw new ServiceError('bad_request', 400, { reason: 'lives_full' });
    if (!w) throw new ServiceError('no_crystals', 402, { price });
    await this.track(userId, 'lives_refilled', null, { price });
    return { lives: view(w.lives, now), wallet: this.walletView(w) };
  }

  // ---------- покупки за Telegram Stars ----------

  /** Счёт на покупку: проверить доступность (стартовый пак, копилка) и зафиксировать цену. */
  async createInvoice(userId: number, product: unknown): Promise<{ invoiceId: string; product: ProductId; stars: number; title: string; description: string }> {
    const w = await this.store.getWallet(userId);
    const now = this.now();
    const eff = await this.configFor(userId);
    const e = eff.economy;
    let stars: number;
    let title: string;
    let description: string;
    if (typeof product === 'string' && product in e.packs) {
      const pack = e.packs[product as keyof Economy['packs']];
      stars = pack.stars;
      title = pack.title;
      description = `${pack.crystals} звёздных кристаллов${pack.bonus ? ` (выгода ${pack.bonus}%)` : ''}`;
    } else if (product === 'starter') {
      if (w.starterBought || w.starterUntil <= now) throw new ServiceError('not_available', 409);
      stars = e.starter.stars;
      title = 'Стартовый набор';
      description = `${e.starter.crystals} кристаллов, 3 бустера и ${e.starter.infiniteLivesMs / 3600_000} ч бесконечных жизней`;
    } else if (product === 'piggy') {
      if (w.piggy < e.piggy.minToBreak) throw new ServiceError('not_available', 409);
      stars = e.piggy.stars;
      title = 'Копилка кристаллов';
      description = `Разбить копилку: ${w.piggy} кристаллов`;
    } else {
      throw new ServiceError('bad_request', 400);
    }
    const invoiceId = `inv${this.newId().replace(/-/g, '').slice(0, 24)}`;
    await this.store.createInvoice({ id: invoiceId, userId, product: product as ProductId, stars, createdAt: now });
    await this.track(userId, 'offer_shown', null, { product, stars, ...expProps(eff) });
    return { invoiceId, product: product as ProductId, stars, title, description };
  }

  /** pre_checkout_query: Telegram ждёт ответ за 10 секунд — только сверка счёта. */
  async preCheckout(invoiceId: string, userId: number, currency: string, amount: number): Promise<string | null> {
    const inv = await this.store.getInvoice(invoiceId);
    if (!inv || inv.userId !== userId || currency !== 'XTR' || amount !== inv.stars) return 'Счёт не найден — попробуй ещё раз';
    if (inv.paidAt !== null) return 'Этот счёт уже оплачен';
    return null;
  }

  /** successful_payment: начислить покупку. Повторный апдейт с тем же charge id ничего не меняет. */
  async completePayment(chargeId: string, invoiceId: string, userId: number, amount: number): Promise<'ok' | 'duplicate' | 'unknown'> {
    const inv = await this.store.getInvoice(invoiceId);
    if (!inv || inv.userId !== userId || inv.stars !== amount) return 'unknown';
    const now = this.now();
    const eff = await this.configFor(userId);
    const e = eff.economy;
    const status = await this.store.recordPayment({ chargeId, invoiceId, userId, product: inv.product, stars: amount, now }, (w): WalletUpdate => {
      if (inv.product === 'starter') {
        const items = Object.fromEntries((Object.entries(e.starter.items) as [Item, number][]).map(([i, n]) => [i, w.items[i] + n]));
        return {
          crystals: w.crystals + e.starter.crystals, items, starterBought: true,
          lives: { ...w.lives, infiniteUntil: Math.max(now, w.lives.infiniteUntil) + e.starter.infiniteLivesMs },
        };
      }
      if (inv.product === 'piggy') return { crystals: w.crystals + w.piggy, piggy: 0 };
      return { crystals: w.crystals + e.packs[inv.product as keyof Economy['packs']].crystals };
    });
    if (status === 'ok') await this.track(userId, 'offer_purchased', null, { product: inv.product, stars: amount, chargeId, ...expProps(eff) });
    return status;
  }

  getPayment(chargeId: string) {
    return this.store.getPayment(chargeId);
  }

  /** Витрина для клиента: цены бустеров, пакеты, стартовый пак и копилка. */
  async shop(userId: number) {
    const e = (await this.configFor(userId)).economy;
    return {
      itemPrices: e.itemPrices, refillLives: e.refillLives, extendPrices: e.extendPrices, extendMoves: e.extendMoves,
      packs: e.packs,
      starter: { stars: e.starter.stars, crystals: e.starter.crystals, items: e.starter.items, infiniteLivesMs: e.starter.infiniteLivesMs },
      piggy: { stars: e.piggy.stars, max: e.piggy.max, minToBreak: e.piggy.minToBreak },
      social: { referralCrystals: e.social.referralCrystals, referralLevel: e.social.referralLevel, giftsPerDay: e.social.giftsPerDay },
    };
  }

  /** Возврат: забрать начисленное (кристаллы не уходят в минус). Сам refundStarPayment делает бот. */
  async refund(chargeId: string): Promise<{ status: 'ok' | 'not_found' | 'already'; userId?: number }> {
    const now = this.now();
    const paid = await this.store.getPayment(chargeId);
    const e = paid ? (await this.configFor(paid.userId)).economy : this.economy;
    const r = await this.store.refundPayment(chargeId, now, (w, product, granted) => {
      const crystals = Math.max(0, w.crystals - granted);
      if (product !== 'starter') return { crystals };
      const items = Object.fromEntries((Object.entries(e.starter.items) as [Item, number][]).map(([i, n]) => [i, Math.max(0, w.items[i] - n)]));
      return { crystals, items, lives: { ...w.lives, infiniteUntil: Math.min(w.lives.infiniteUntil, now) } };
    });
    if (r.status === 'ok') await this.track(r.userId!, 'refund', null, { chargeId });
    return r;
  }

  private async closeAsLoss(
    attempt: AttemptRow, status: 'lost' | 'abandoned' | 'rejected', swaps: readonly Move[], countsAsLoss = true, game?: Match3Game,
  ): Promise<FinishResponse> {
    const score = game?.score ?? 0;
    const now = this.now();
    const user = (await this.store.getUser(attempt.userId))!;
    const prev = (await this.store.getLevelProgress(attempt.userId, attempt.levelId)) ?? emptyProgress(attempt.levelId);
    // попытка в комнате не влияет на прогресс карты и серию поражений уровня
    const progress = countsAsLoss && !attempt.roomId ? { ...prev, losses: prev.losses + 1, lossStreak: prev.lossStreak + 1 } : null;
    await this.store.closeAttempt(attempt.id, attempt.userId, {
      status, finishedAt: now, score, stars: 0, swaps, lives: user.lives, progress, maxLevel: user.maxLevel,
    });
    if (status === 'lost' && !attempt.roomId && score > 0) await this.bumpTasks(attempt.userId, { score });
    // PRD: level_fail — с оставшимися ходами и прогрессом цели
    await this.track(attempt.userId, attempt.roomId ? 'room_fail' : 'level_fail', attempt.levelId, {
      ...(attempt.roomId ? { roomId: attempt.roomId } : {}),
      attemptId: attempt.id, reason: status, score, movesUsed: swaps.length,
      movesLeft: game ? game.movesLeft : null, goalProgress: game ? Math.round(goalProgress(game) * 100) / 100 : null,
      assist: attempt.assist,
    });
    return {
      result: 'lost', score, stars: 0, bestScore: prev.bestScore, lives: view(user.lives, now), maxLevel: user.maxLevel,
      wallet: await this.wallet(attempt.userId),
    };
  }
}

/** Уровни для челленджа: без таймера, не обучающий первый, в пределах пройденного создателем (но не меньше 2–4). */
export function roomLevelPool(levels: ReadonlyMap<number, LevelDef>, creatorMaxLevel: number): number[] {
  const top = Math.max(4, Math.min(creatorMaxLevel, 15));
  return [...levels.values()].filter((l) => l.id >= 2 && l.id <= top && l.timeLimit === undefined).map((l) => l.id).sort((a, b) => a - b);
}

const MAX_LIVES_VIEW = 5;

export interface GateView {
  readonly episode: number;
  readonly levelId: number;
  readonly keys: number;
  readonly needed: number;
  readonly unlockAt: number;
  readonly price: number;
}

/** Победа открыла первый уровень нового района — запомнить, когда игрок подошёл к воротам. */
function withGate(meta: MetaState, maxLevel: number, now: number, levelCount: number): MetaState {
  const episode = episodeOf(maxLevel);
  if (episode < 2 || maxLevel !== (episode - 1) * LEVELS_PER_EPISODE + 1 || maxLevel > levelCount || meta.gates?.[String(episode)]) return meta;
  return { ...meta, gates: { ...meta.gates, [String(episode)]: { reachedAt: now, keys: [] } } };
}
const STUCK_REWARD: Reward = { items: { hammer: 1, beamBomb: 1 } };

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

/** Варианты экспериментов в событиях — для разбивки отчёта. */
const expProps = (eff: Effective) => (Object.keys(eff.variants).length > 0 ? { exp: eff.variants } : {});

/** Бустеры перед уровнем из запроса: только известные, без повторов. */
function parseStartBoosters(input: readonly unknown[]): Item[] {
  if (!Array.isArray(input) || input.length > START_ITEMS.length) throw new ServiceError('bad_request', 400);
  const items = [...new Set(input)];
  if (items.length !== input.length || !items.every((i) => isItem(i) && START_ITEMS.includes(i))) throw new ServiceError('bad_request', 400);
  return items as Item[];
}

/**
 * Действия от клиента: свапы { a, b }, бустеры { booster: 'hammer', at } / { booster: 'freeSwap', a, b } /
 * { booster: 'shuffle' } и докупка { extraMoves: n }. Лишние поля отбрасываются.
 */
export function parseMoves(input: unknown): Move[] | null {
  if (!Array.isArray(input) || input.length > MAX_SWAPS) return null;
  const cell = (p: unknown): p is Pos => typeof p === 'object' && p !== null
    && Number.isInteger((p as { row: unknown }).row) && Number.isInteger((p as { col: unknown }).col);
  const pos = (p: Pos): Pos => ({ row: p.row, col: p.col });
  const out: Move[] = [];
  for (const m of input) {
    if (typeof m !== 'object' || m === null) return null;
    const x = m as Record<string, unknown>;
    if ('extraMoves' in x) {
      if (!Number.isInteger(x.extraMoves)) return null;
      out.push({ extraMoves: x.extraMoves as number });
    } else if ('booster' in x) {
      if (x.booster === 'hammer' && cell(x.at)) out.push({ booster: 'hammer', at: pos(x.at) });
      else if (x.booster === 'freeSwap' && cell(x.a) && cell(x.b)) out.push({ booster: 'freeSwap', a: pos(x.a), b: pos(x.b) });
      else if (x.booster === 'shuffle') out.push({ booster: 'shuffle' });
      else return null;
    } else if (cell(x.a) && cell(x.b)) {
      out.push({ a: pos(x.a), b: pos(x.b) });
    } else {
      return null;
    }
  }
  return out;
}

/** Совместимость: старое имя. */
export const parseSwaps = parseMoves;
export { GAME_ITEMS };
