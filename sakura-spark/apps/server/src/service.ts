import { randomInt, randomUUID } from 'node:crypto';
import { assistForLossStreak, gameOptionsFromLevel, Match3Game } from '@sakura/core';
import type { LevelDef, Swap } from '@sakura/core';
import type { TelegramUser } from './auth.ts';
import { canPlay, fullLives, refund, spend, view } from './lives.ts';
import type { LivesView } from './lives.ts';
import type { AttemptRow, LevelProgress, Store, UserRow } from './store.ts';

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

export class ServiceError extends Error {
  constructor(
    readonly code: 'unknown_level' | 'level_locked' | 'no_lives' | 'not_found' | 'not_open' | 'invalid_replay' | 'bad_request',
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
}

export interface FinishResponse {
  readonly result: 'won' | 'lost';
  readonly score: number;
  readonly stars: number;
  readonly bestScore: number;
  readonly lives: LivesView;
  readonly maxLevel: number;
}

export interface ServiceDeps {
  readonly store: Store;
  readonly levels: ReadonlyMap<number, LevelDef>;
  readonly now?: () => number;
  readonly newSeed?: () => number;
  readonly newId?: () => string;
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

  constructor(deps: ServiceDeps) {
    this.store = deps.store;
    this.levels = deps.levels;
    this.now = deps.now ?? Date.now;
    this.newSeed = deps.newSeed ?? (() => randomInt(2 ** 31));
    this.newId = deps.newId ?? randomUUID;
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
      assist: assistForLossStreak(progress.lossStreak), startedAt: now,
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

    const now = this.now();
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
    const progress = countsAsLoss ? { ...prev, losses: prev.losses + 1, lossStreak: prev.lossStreak + 1 } : null;
    await this.store.closeAttempt(attempt.id, attempt.userId, {
      status, finishedAt: now, score, stars: 0, swaps, lives: user.lives, progress, maxLevel: user.maxLevel,
    });
    // PRD: level_fail — с оставшимися ходами и прогрессом цели
    await this.track(attempt.userId, 'level_fail', attempt.levelId, {
      attemptId: attempt.id, reason: status, score, movesUsed: swaps.length,
      movesLeft: game ? game.movesLeft : null, goalProgress: game ? Math.round(goalProgress(game) * 100) / 100 : null,
      assist: attempt.assist,
    });
    return { result: 'lost', score, stars: 0, bestScore: prev.bestScore, lives: view(user.lives, now), maxLevel: user.maxLevel };
  }
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
