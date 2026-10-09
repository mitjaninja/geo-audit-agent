import { DatabaseSync } from 'node:sqlite';
import type { Swap } from '@sakura/core';
import type { TelegramUser } from './auth.ts';
import type { LivesState } from './lives.ts';

export interface UserRow {
  readonly id: number;
  readonly firstName: string;
  readonly username: string | null;
  readonly languageCode: string | null;
  readonly createdAt: number;
  readonly lives: LivesState;
  /** Наибольший открытый уровень. */
  readonly maxLevel: number;
}

export interface LevelProgress {
  readonly levelId: number;
  readonly bestScore: number;
  readonly stars: number;
  readonly wins: number;
  readonly losses: number;
  /** Поражений подряд — для скрытого облегчения. */
  readonly lossStreak: number;
}

export type AttemptStatus = 'open' | 'won' | 'lost' | 'abandoned' | 'rejected';

export interface AttemptRow {
  readonly id: string;
  readonly userId: number;
  readonly levelId: number;
  readonly seed: number;
  readonly assist: number;
  readonly startedAt: number;
  readonly status: AttemptStatus;
  readonly finishedAt: number | null;
  readonly score: number | null;
  readonly stars: number | null;
}

export interface AttemptClose {
  readonly status: Exclude<AttemptStatus, 'open'>;
  readonly finishedAt: number;
  readonly score: number;
  readonly stars: number;
  readonly swaps: readonly Swap[];
  readonly lives: LivesState;
  /** null — прогресс уровня не меняется (подделанный реплей). */
  readonly progress: LevelProgress | null;
  readonly maxLevel: number;
}

/** Событие аналитики (PRD: level_start, level_win, level_fail, lives_empty, session_start/end …). */
export interface EventRow {
  readonly userId: number;
  readonly name: string;
  readonly ts: number;
  readonly levelId: number | null;
  readonly props: Record<string, unknown>;
}

export interface LevelStats {
  readonly levelId: number;
  readonly starts: number;
  readonly wins: number;
  readonly fails: number;
  /** wins / (wins + fails) — брошенные партии считаются поражениями. */
  readonly winRate: number;
  /** Доля поражений при прогрессе целей ≥ 80% — кандидаты на окно «+5 ходов». */
  readonly nearMissRate: number;
  readonly avgMovesLeftOnWin: number;
}

export interface Report {
  readonly users: number;
  /** PRD: установка → уровень 10 → уровень 30 (покупки — после этапа платежей). */
  readonly funnel: { readonly installs: number; readonly level10: number; readonly level30: number };
  /** Доля игроков, вернувшихся через 24–48 ч после установки (только для установок старше 48 ч). */
  readonly d1: { readonly cohort: number; readonly returned: number; readonly rate: number | null };
  readonly levels: LevelStats[];
}

/**
 * Хранилище. Интерфейс асинхронный, чтобы позже заменить SQLite на Postgres без переделки сервиса.
 * Составные операции (createAttempt, closeAttempt) атомарны.
 */
export interface Store {
  upsertUser(u: TelegramUser, now: number, initialLives: LivesState): Promise<UserRow>;
  getUser(id: number): Promise<UserRow | null>;
  saveLives(userId: number, lives: LivesState): Promise<void>;
  getProgress(userId: number): Promise<LevelProgress[]>;
  getLevelProgress(userId: number, levelId: number): Promise<LevelProgress | null>;
  getOpenAttempt(userId: number): Promise<AttemptRow | null>;
  getAttempt(id: string): Promise<AttemptRow | null>;
  /** Создать попытку и списать жизнь одной транзакцией. */
  createAttempt(a: Omit<AttemptRow, 'status' | 'finishedAt' | 'score' | 'stars'>, lives: LivesState): Promise<void>;
  /** Закрыть попытку, если она ещё открыта. false — уже закрыта (повторный запрос). */
  closeAttempt(id: string, userId: number, c: AttemptClose): Promise<boolean>;
  addEvents(events: readonly EventRow[]): Promise<void>;
  getEvents(userId: number): Promise<EventRow[]>;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  username TEXT,
  language_code TEXT,
  created_at INTEGER NOT NULL,
  lives INTEGER NOT NULL,
  lives_updated_at INTEGER NOT NULL,
  infinite_until INTEGER NOT NULL DEFAULT 0,
  max_level INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS level_progress (
  user_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  loss_streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, level_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  assist REAL NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  finished_at INTEGER,
  score INTEGER,
  stars INTEGER,
  swaps TEXT
);
CREATE INDEX IF NOT EXISTS attempts_user_status ON attempts (user_id, status);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  level_id INTEGER,
  props TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_name_ts ON events (name, ts);
CREATE INDEX IF NOT EXISTS events_user_ts ON events (user_id, ts);
`;

type Row = Record<string, unknown>;

const toUser = (r: Row): UserRow => ({
  id: Number(r.id),
  firstName: String(r.first_name),
  username: (r.username as string | null) ?? null,
  languageCode: (r.language_code as string | null) ?? null,
  createdAt: Number(r.created_at),
  lives: { lives: Number(r.lives), updatedAt: Number(r.lives_updated_at), infiniteUntil: Number(r.infinite_until) },
  maxLevel: Number(r.max_level),
});

const toProgress = (r: Row): LevelProgress => ({
  levelId: Number(r.level_id),
  bestScore: Number(r.best_score),
  stars: Number(r.stars),
  wins: Number(r.wins),
  losses: Number(r.losses),
  lossStreak: Number(r.loss_streak),
});

const toAttempt = (r: Row): AttemptRow => ({
  id: String(r.id),
  userId: Number(r.user_id),
  levelId: Number(r.level_id),
  seed: Number(r.seed),
  assist: Number(r.assist),
  startedAt: Number(r.started_at),
  status: r.status as AttemptStatus,
  finishedAt: r.finished_at === null ? null : Number(r.finished_at),
  score: r.score === null ? null : Number(r.score),
  stars: r.stars === null ? null : Number(r.stars),
});

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  /** path ':memory:' — для тестов. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async upsertUser(u: TelegramUser, now: number, initialLives: LivesState): Promise<UserRow> {
    this.db.prepare(`
      INSERT INTO users (id, first_name, username, language_code, created_at, lives, lives_updated_at, infinite_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
        language_code = excluded.language_code
    `).run(u.id, u.firstName, u.username ?? null, u.languageCode ?? null, now,
      initialLives.lives, initialLives.updatedAt, initialLives.infiniteUntil);
    return (await this.getUser(u.id))!;
  }

  async getUser(id: number): Promise<UserRow | null> {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r ? toUser(r) : null;
  }

  async saveLives(userId: number, l: LivesState): Promise<void> {
    this.db.prepare('UPDATE users SET lives = ?, lives_updated_at = ?, infinite_until = ? WHERE id = ?')
      .run(l.lives, l.updatedAt, l.infiniteUntil, userId);
  }

  async getProgress(userId: number): Promise<LevelProgress[]> {
    return (this.db.prepare('SELECT * FROM level_progress WHERE user_id = ? ORDER BY level_id').all(userId) as Row[]).map(toProgress);
  }

  async getLevelProgress(userId: number, levelId: number): Promise<LevelProgress | null> {
    const r = this.db.prepare('SELECT * FROM level_progress WHERE user_id = ? AND level_id = ?').get(userId, levelId) as Row | undefined;
    return r ? toProgress(r) : null;
  }

  async getOpenAttempt(userId: number): Promise<AttemptRow | null> {
    const r = this.db.prepare("SELECT * FROM attempts WHERE user_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1")
      .get(userId) as Row | undefined;
    return r ? toAttempt(r) : null;
  }

  async getAttempt(id: string): Promise<AttemptRow | null> {
    const r = this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as Row | undefined;
    return r ? toAttempt(r) : null;
  }

  async createAttempt(a: Omit<AttemptRow, 'status' | 'finishedAt' | 'score' | 'stars'>, lives: LivesState): Promise<void> {
    this.tx(() => {
      this.db.prepare("INSERT INTO attempts (id, user_id, level_id, seed, assist, started_at, status) VALUES (?, ?, ?, ?, ?, ?, 'open')")
        .run(a.id, a.userId, a.levelId, a.seed, a.assist, a.startedAt);
      this.db.prepare('UPDATE users SET lives = ?, lives_updated_at = ?, infinite_until = ? WHERE id = ?')
        .run(lives.lives, lives.updatedAt, lives.infiniteUntil, a.userId);
    });
  }

  async closeAttempt(id: string, userId: number, c: AttemptClose): Promise<boolean> {
    return this.tx(() => {
      const res = this.db.prepare(`
        UPDATE attempts SET status = ?, finished_at = ?, score = ?, stars = ?, swaps = ?
        WHERE id = ? AND user_id = ? AND status = 'open'
      `).run(c.status, c.finishedAt, c.score, c.stars, JSON.stringify(c.swaps), id, userId);
      if (Number(res.changes) === 0) return false;
      this.db.prepare('UPDATE users SET lives = ?, lives_updated_at = ?, infinite_until = ?, max_level = MAX(max_level, ?) WHERE id = ?')
        .run(c.lives.lives, c.lives.updatedAt, c.lives.infiniteUntil, c.maxLevel, userId);
      const p = c.progress;
      if (p) {
        this.db.prepare(`
          INSERT INTO level_progress (user_id, level_id, best_score, stars, wins, losses, loss_streak)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, level_id) DO UPDATE SET best_score = excluded.best_score, stars = excluded.stars,
            wins = excluded.wins, losses = excluded.losses, loss_streak = excluded.loss_streak
        `).run(userId, p.levelId, p.bestScore, p.stars, p.wins, p.losses, p.lossStreak);
      }
      return true;
    });
  }

  async addEvents(events: readonly EventRow[]): Promise<void> {
    if (events.length === 0) return;
    this.tx(() => {
      const insert = this.db.prepare('INSERT INTO events (user_id, name, ts, level_id, props) VALUES (?, ?, ?, ?, ?)');
      for (const e of events) insert.run(e.userId, e.name, e.ts, e.levelId, JSON.stringify(e.props));
    });
  }

  async getEvents(userId: number): Promise<EventRow[]> {
    return (this.db.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY id').all(userId) as Row[]).map((r) => ({
      userId: Number(r.user_id), name: String(r.name), ts: Number(r.ts),
      levelId: r.level_id === null ? null : Number(r.level_id), props: JSON.parse(String(r.props)) as Record<string, unknown>,
    }));
  }

  /** Сводка для продукта: воронка, D1, статистика уровней. Только SQLite — для скрипта report. */
  report(now: number): Report {
    const one = (sql: string, ...args: (number | string)[]) => Number(Object.values(this.db.prepare(sql).get(...args) as Row)[0] ?? 0);
    const day = 24 * 3600_000;
    const cohort = one('SELECT COUNT(*) FROM users WHERE created_at <= ?', now - 2 * day);
    const returned = one(`
      SELECT COUNT(*) FROM users u WHERE u.created_at <= ? AND EXISTS (
        SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name = 'session_start'
          AND e.ts >= u.created_at + ? AND e.ts < u.created_at + ?)`, now - 2 * day, day, 2 * day);
    const levels = (this.db.prepare(`
      SELECT level_id,
        SUM(name = 'level_start') AS starts,
        SUM(name = 'level_win') AS wins,
        SUM(name = 'level_fail') AS fails,
        SUM(name = 'level_fail' AND json_extract(props, '$.goalProgress') >= 0.8) AS near,
        AVG(CASE WHEN name = 'level_win' THEN json_extract(props, '$.movesLeft') END) AS moves_left
      FROM events WHERE level_id IS NOT NULL AND name IN ('level_start', 'level_win', 'level_fail')
      GROUP BY level_id ORDER BY level_id`).all() as Row[]).map((r) => {
      const wins = Number(r.wins);
      const fails = Number(r.fails);
      return {
        levelId: Number(r.level_id), starts: Number(r.starts), wins, fails,
        winRate: wins + fails > 0 ? wins / (wins + fails) : 0,
        nearMissRate: fails > 0 ? Number(r.near) / fails : 0,
        avgMovesLeftOnWin: r.moves_left === null ? 0 : Number(r.moves_left),
      };
    });
    return {
      users: one('SELECT COUNT(*) FROM users'),
      funnel: {
        installs: one('SELECT COUNT(*) FROM users'),
        level10: one('SELECT COUNT(*) FROM users WHERE max_level >= 10'),
        level30: one('SELECT COUNT(*) FROM users WHERE max_level >= 30'),
      },
      d1: { cohort, returned, rate: cohort > 0 ? returned / cohort : null },
      levels,
    };
  }

  close(): void {
    this.db.close();
  }
}
