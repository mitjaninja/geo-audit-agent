import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { assistForLossStreak, gameOptionsFromLevel, Match3Game } from '@sakura/core';
import type { LevelDef, Swap } from '@sakura/core';
import type { TelegramUser } from './auth.ts';
import { canPlay, fullLives, refund, spend, view } from './lives.ts';
import type { LivesView } from './lives.ts';
import type { AttemptRow, LevelProgress, RoomMode, RoomRow, Store, UserRow } from './store.ts';

/** События, которые может прислать клиент. Игровые итоги пишет только сервер — по реплею. */
export const CLIENT_EVENTS: ReadonlySet<string> = new Set(['session_start', 'session_end', 'hint_shown', 'tutorial_complete']);
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
  readonly top: { readonly place: number; readonly name: string; readonly score: number; readonly stars: number }[];
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
      | 'room_limit' | 'room_expired',
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface MeResponse {
  readonly user: { readonly id: number; readonly firstName: string };
  readonly lives: LivesView;
  readonly maxLevel: number;
  readonly levels: Record<number, { readonly stars: number; readonly bestScore: number }>;
  readonly levelCount: number;
  readonly serverTime: number;
}

export interface StartResponse {
  readonly attemptId: string;
  readonly seed: number;
  readonly level: LevelDef;
  readonly lives: LivesView;
  readonly roomId?: string;
}

export interface FinishResponse {
  readonly result: 'won' | 'lost';
  readonly score: number;
  readonly stars: number;
  readonly bestScore: number;
  readonly lives: LivesView;
  readonly maxLevel: number;
  /** Для попытки в комнате: место в рейтинге чата. */
  readonly room?: { readonly id: string; readonly place: number; readonly players: number };
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

  constructor(deps: ServiceDeps) {
    this.store = deps.store;
    this.levels = deps.levels;
    this.now = deps.now ?? Date.now;
    this.newSeed = deps.newSeed ?? (() => randomInt(2 ** 31));
    this.newId = deps.newId ?? randomUUID;
    this.newRoomId = deps.newRoomId ?? newRoomId;
    this.onRoomChanged = deps.onRoomChanged ?? (() => {});
  }

  async login(u: TelegramUser): Promise<UserRow> {
    const existed = await this.store.getUser(u.id);
    const user = await this.store.upsertUser(u, this.now(), fullLives(this.now()));
    if (!existed) await this.track(u.id, 'install', null, { language: u.languageCode ?? null });
    return user;
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
    return {
      user: { id: user.id, firstName: user.firstName },
      lives: view(user.lives, this.now()),
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
  async startAttempt(userId: number, levelId: number): Promise<StartResponse> {
    const level = this.levels.get(levelId);
    if (!level) throw new ServiceError('unknown_level', 404);
    let user = (await this.store.getUser(userId))!;
    if (levelId > user.maxLevel) throw new ServiceError('level_locked', 403, { maxLevel: user.maxLevel });

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
    const lives = spend(user.lives, now);
    const attempt = {
      id: this.newId(), userId, levelId, seed: this.newSeed(),
      // PRD: после 5+ поражений подряд — скрытое облегчение
      assist: assistForLossStreak(progress.lossStreak), startedAt: now, roomId: null,
    };
    await this.store.createAttempt(attempt, lives);
    await this.track(userId, 'level_start', levelId, { attemptId: attempt.id, assist: attempt.assist });
    return { attemptId: attempt.id, seed: attempt.seed, level, lives: view(lives, now) };
  }

  /**
   * Завершить попытку. Победа возвращает зарезервированную жизнь; поражение и брошенная
   * партия её оставляют потраченной. Подделанный реплей — тоже потраченная жизнь.
   */
  async finishAttempt(userId: number, attemptId: string, swaps: unknown, timedOut: boolean): Promise<FinishResponse> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt || attempt.userId !== userId) throw new ServiceError('not_found', 404);
    if (attempt.status !== 'open') throw new ServiceError('not_open', 409, { status: attempt.status });
    const parsed = parseSwaps(swaps);
    if (!parsed) {
      await this.closeAsLoss(attempt, 'rejected', [], false);
      throw new ServiceError('invalid_replay', 400);
    }
    const level = this.levels.get(attempt.levelId)!;
    let game: Match3Game;
    try {
      game = Match3Game.replay(this.optionsFor(attempt, level), parsed);
    } catch {
      await this.closeAsLoss(attempt, 'rejected', parsed, false);
      throw new ServiceError('invalid_replay', 400);
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
    await this.track(userId, 'level_win', level.id, {
      attemptId: attempt.id, score: game.score, stars: game.stars, movesUsed: parsed.length,
      movesLeft: level.timeLimit === undefined ? game.movesLeft : null, assist: attempt.assist,
    });
    return { result: 'won', score: game.score, stars: game.stars, bestScore: progress.bestScore, lives: view(lives, now), maxLevel };
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
      top: results.slice(0, ROOM_TOP).map((r, i) => ({ place: i + 1, name: r.firstName, score: r.bestScore, stars: r.stars })),
      me: { place: mine >= 0 ? mine + 1 : null, bestScore: mine >= 0 ? results[mine]!.bestScore : null, attempts },
      nextAttemptFree: attempts === 0, gifts: room.gifts, maxGifts: MAX_GIFTS, serverTime: now,
    };
  }

  /** Попытка в челлендже: тот же уровень и сид, что у всех; первая бесплатна, дальше — жизнь. */
  async startRoomAttempt(userId: number, roomId: string): Promise<StartResponse> {
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
    const lives = free ? user.lives : spend(user.lives, now);
    // облегчение в комнате не даём: у всех должно быть одинаковое выпадение фишек
    const attempt = { id: this.newId(), userId, levelId: room.levelId, seed: room.seed, assist: 0, startedAt: now, roomId };
    await this.store.createAttempt(attempt, lives);
    await this.track(userId, 'room_start', room.levelId, { roomId, attemptId: attempt.id, free });
    return { attemptId: attempt.id, seed: room.seed, level: this.levels.get(room.levelId)!, lives: view(lives, now), roomId };
  }

  private async finishRoomAttempt(attempt: AttemptRow, game: Match3Game, swaps: readonly Swap[]): Promise<FinishResponse> {
    const now = this.now();
    // рейтинг честный: ходы быстрее анимаций — скрипт, результат не засчитываем
    if (swaps.length > 0 && now - attempt.startedAt < swaps.length * MIN_MS_PER_MOVE) {
      await this.closeAsLoss(attempt, 'rejected', swaps, false);
      throw new ServiceError('invalid_replay', 400, { reason: 'too_fast' });
    }
    const user = (await this.store.getUser(attempt.userId))!;
    const won = game.status === 'won';
    await this.store.recordRoomResult(attempt.roomId!, {
      userId: user.id, firstName: user.firstName, bestScore: game.score, stars: game.stars, won,
    }, now);
    await this.store.closeAttempt(attempt.id, user.id, {
      status: won ? 'won' : 'lost', finishedAt: now, score: game.score, stars: game.stars, swaps,
      lives: user.lives, progress: null, maxLevel: user.maxLevel,
    });
    await this.track(user.id, 'room_finish', attempt.levelId, {
      roomId: attempt.roomId, attemptId: attempt.id, score: game.score, stars: game.stars, won, movesLeft: game.movesLeft,
    });
    const results = await this.store.getRoomResults(attempt.roomId!);
    const place = results.findIndex((r) => r.userId === user.id) + 1;
    this.onRoomChanged(attempt.roomId!);
    return {
      result: won ? 'won' : 'lost', score: game.score, stars: game.stars, bestScore: results[place - 1]?.bestScore ?? game.score,
      lives: view(user.lives, now), maxLevel: user.maxLevel, room: { id: attempt.roomId!, place, players: results.length },
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
      this.onRoomChanged(roomId);
    }
    return { status, gifts };
  }

  private optionsFor(a: AttemptRow, level: LevelDef) {
    const opts = gameOptionsFromLevel(level, a.seed);
    return a.assist > 0 ? { ...opts, assist: a.assist } : opts;
  }

  private async closeAsLoss(
    attempt: AttemptRow, status: 'lost' | 'abandoned' | 'rejected', swaps: readonly Swap[], countsAsLoss = true, game?: Match3Game,
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
    // PRD: level_fail — с оставшимися ходами и прогрессом цели
    await this.track(attempt.userId, attempt.roomId ? 'room_fail' : 'level_fail', attempt.levelId, {
      ...(attempt.roomId ? { roomId: attempt.roomId } : {}),
      attemptId: attempt.id, reason: status, score, movesUsed: swaps.length,
      movesLeft: game ? game.movesLeft : null, goalProgress: game ? Math.round(goalProgress(game) * 100) / 100 : null,
      assist: attempt.assist,
    });
    return { result: 'lost', score, stars: 0, bestScore: prev.bestScore, lives: view(user.lives, now), maxLevel: user.maxLevel };
  }
}

/** Уровни для челленджа: без таймера, не обучающий первый, в пределах пройденного создателем (но не меньше 2–4). */
export function roomLevelPool(levels: ReadonlyMap<number, LevelDef>, creatorMaxLevel: number): number[] {
  const top = Math.max(4, Math.min(creatorMaxLevel, 15));
  return [...levels.values()].filter((l) => l.id >= 2 && l.id <= top && l.timeLimit === undefined).map((l) => l.id).sort((a, b) => a - b);
}

/** Ходы от клиента: массив { a: {row, col}, b: {row, col} } с целыми координатами. */
export function parseSwaps(input: unknown): Swap[] | null {
  if (!Array.isArray(input) || input.length > MAX_SWAPS) return null;
  const cell = (p: unknown) => typeof p === 'object' && p !== null
    && Number.isInteger((p as { row: unknown }).row) && Number.isInteger((p as { col: unknown }).col);
  const out: Swap[] = [];
  for (const s of input) {
    if (typeof s !== 'object' || s === null || !cell((s as Swap).a) || !cell((s as Swap).b)) return null;
    const { a, b } = s as Swap;
    out.push({ a: { row: a.row, col: a.col }, b: { row: b.row, col: b.col } });
  }
  return out;
}
