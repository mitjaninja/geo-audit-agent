import { DatabaseSync } from 'node:sqlite';
import type { Move } from '@sakura/core';
import type { TelegramUser } from './auth.ts';
import type { LivesState } from './lives.ts';
import { ITEMS } from './economy.ts';
import type { MetaState } from './meta.ts';
import type { Item, ProductId } from './economy.ts';

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

export type RoomMode = 'challenge' | 'help';

export interface RoomRow {
  readonly id: string;
  readonly mode: RoomMode;
  readonly creatorId: number;
  readonly creatorName: string;
  readonly levelId: number;
  readonly seed: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** Карточка в чате: её редактирует бот (рейтинг, подарки). null — пока неизвестна. */
  readonly inlineMessageId: string | null;
  readonly gifts: number;
}

export interface RoomResult {
  readonly userId: number;
  readonly firstName: string;
  readonly bestScore: number;
  readonly stars: number;
  readonly won: boolean;
  readonly attempts: number;
  /** Счёт поставлен с бустерами — в рейтинге чата помечается значком. */
  readonly boosted: boolean;
}

/** Кошелёк игрока: всё, что меняется покупками и тратами, — читается и пишется одной транзакцией. */
export interface Wallet {
  readonly crystals: number;
  readonly piggy: number;
  readonly items: Readonly<Record<Item, number>>;
  readonly starterUntil: number;
  readonly starterBought: boolean;
  readonly lives: LivesState;
  /** Мета: задания, календарь, колесо, сундуки, карточки (JSON в строке игрока). */
  readonly meta: MetaState;
}

/** Новые значения кошелька (абсолютные); items — только изменённые предметы. */
export interface WalletUpdate {
  readonly crystals?: number;
  readonly piggy?: number;
  readonly items?: Partial<Record<Item, number>>;
  readonly starterUntil?: number;
  readonly starterBought?: boolean;
  readonly lives?: LivesState;
  readonly meta?: MetaState;
}

export interface InvoiceRow {
  readonly id: string;
  readonly userId: number;
  readonly product: ProductId;
  readonly stars: number;
  readonly createdAt: number;
  readonly paidAt: number | null;
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
  /** Попытка в комнате чат-режима; null — обычный уровень карты. */
  readonly roomId: string | null;
  /** Бустеры перед уровнем, оплаченные при старте. */
  readonly startBoosters: readonly Item[];
  /** Сколько раз оплачено «+5 ходов». */
  readonly extensions: number;
  /** Ходы и время уровня, если remote config их сдвинул (null — как в файле уровня). */
  readonly moves: number | null;
  readonly timeLimit: number | null;
}

export interface ConfigRow {
  readonly id: number;
  readonly json: string;
  readonly createdAt: number;
  readonly authorId: number | null;
}

/** Итоги игрока для отчёта по экспериментам. */
export interface UserOutcome {
  readonly userId: number;
  readonly createdAt: number;
  readonly maxLevel: number;
  readonly wins: number;
  readonly fails: number;
  readonly starsPaid: number;
  readonly returnedD1: boolean;
}

export interface AttemptClose {
  readonly status: Exclude<AttemptStatus, 'open'>;
  readonly finishedAt: number;
  readonly score: number;
  readonly stars: number;
  readonly swaps: readonly Move[];
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
  /**
   * «Чистые» партии — без облегчения, бустеров, докупки ходов и сдвига конфига: их win rate сравним
   * с казуальным ботом (калибровка CASUAL_SKILL). Брошенные партии сюда не входят.
   */
  readonly cleanGames: number;
  readonly cleanWinRate: number;
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
  createAttempt(a: Omit<AttemptRow, 'status' | 'finishedAt' | 'score' | 'stars' | 'extensions'>, lives: LivesState): Promise<void>;
  getWallet(userId: number): Promise<Wallet>;
  /**
   * Атомарно: прочитать кошелёк, решить (fn), записать. fn вернула null — ничего не меняется
   * (например, не хватает кристаллов). Возвращает новый кошелёк или null.
   */
  transact(userId: number, fn: (w: Wallet) => WalletUpdate | null): Promise<Wallet | null>;
  /** «+5 ходов»: в одной транзакции проверить, что попытка открыта, и списать цену очередной докупки. */
  extendAttempt(attemptId: string, userId: number, priceFor: (extensions: number) => number): Promise<{ status: 'ok' | 'no_crystals' | 'not_open'; price: number; wallet: Wallet | null }>;
  createInvoice(i: Omit<InvoiceRow, 'paidAt'>): Promise<void>;
  getPayment(chargeId: string): Promise<{ userId: number; product: ProductId; stars: number; refunded: boolean } | null>;
  getInvoice(id: string): Promise<InvoiceRow | null>;
  /** Успешный платёж: начислить ровно один раз на charge id (Telegram может прислать апдейт повторно). */
  recordPayment(p: { chargeId: string; invoiceId: string; userId: number; product: ProductId; stars: number; now: number },
    grant: (w: Wallet) => WalletUpdate): Promise<'ok' | 'duplicate'>;
  /** Возврат: пометить платёж и забрать начисленное (кристаллы не уходят ниже нуля). */
  refundPayment(chargeId: string, now: number, revoke: (w: Wallet, product: ProductId, grantedCrystals: number) => WalletUpdate): Promise<{ status: 'ok' | 'not_found' | 'already'; userId?: number }>;
  createRoom(room: RoomRow): Promise<void>;
  getRoom(id: string): Promise<RoomRow | null>;
  setRoomMessage(id: string, inlineMessageId: string): Promise<void>;
  /** Комнаты, «ушедшие в чат» (есть карточка или игроки) — для лимита 5 карточек в день. */
  countActiveRooms(creatorId: number, since: number): Promise<number>;
  countRoomAttempts(roomId: string, userId: number): Promise<number>;
  recordRoomResult(roomId: string, r: Omit<RoomResult, 'attempts'>, now: number): Promise<void>;
  getRoomResults(roomId: string): Promise<RoomResult[]>;
  /**
   * Подарок жизни в карточке «Помощь жизнью»: атомарно проверяет, что даритель ещё не дарил
   * и лимит не исчерпан, и меняет жизни просящего функцией giveLife.
   */
  addGift(roomId: string, giverId: number, now: number, maxGifts: number, giveLife: (l: LivesState) => LivesState): Promise<'ok' | 'already' | 'full'>;
  /** Удалить истёкшие комнаты, в которые никто не играл. */
  pruneRooms(now: number): Promise<number>;
  /** Закрыть попытку, если она ещё открыта. false — уже закрыта (повторный запрос). */
  closeAttempt(id: string, userId: number, c: AttemptClose): Promise<boolean>;
  addEvents(events: readonly EventRow[]): Promise<void>;
  getEvents(userId: number): Promise<EventRow[]>;
  /** Remote config: последняя запись — действующая, остальные — история для отката. */
  getConfig(): Promise<ConfigRow | null>;
  saveConfig(json: string, now: number, authorId: number | null): Promise<ConfigRow>;
  configHistory(limit: number): Promise<ConfigRow[]>;
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

/** Миграции схемы по порядку; индекс + 1 = PRAGMA user_version после неё. Только дописывать в конец. */
const MIGRATIONS: readonly string[] = [
  SCHEMA,
  // v2: чат-режимы — комнаты (общий уровень и сид), их результаты, подарки жизни
  `ALTER TABLE attempts ADD COLUMN room_id TEXT;
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    creator_id INTEGER NOT NULL,
    creator_name TEXT NOT NULL,
    level_id INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    inline_message_id TEXT,
    gifts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX rooms_creator ON rooms (creator_id, created_at);
  CREATE TABLE room_results (
    room_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    best_score INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    won INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE TABLE room_gifts (
    room_id TEXT NOT NULL,
    giver_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (room_id, giver_id)
  );
  CREATE INDEX attempts_room_user ON attempts (room_id, user_id);`,
  // v3: экономика — кристаллы, склад бустеров, копилка, стартовый пак, счета и платежи Stars
  `ALTER TABLE users ADD COLUMN crystals INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN piggy INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN starter_until INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN starter_bought INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE attempts ADD COLUMN start_boosters TEXT;
  ALTER TABLE attempts ADD COLUMN extensions INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE room_results ADD COLUMN boosted INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE inventory (user_id INTEGER NOT NULL, item TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, item));
  CREATE TABLE invoices (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, product TEXT NOT NULL, stars INTEGER NOT NULL,
    created_at INTEGER NOT NULL, paid_at INTEGER
  );
  CREATE TABLE payments (
    charge_id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, user_id INTEGER NOT NULL, product TEXT NOT NULL,
    stars INTEGER NOT NULL, created_at INTEGER NOT NULL, refunded_at INTEGER, granted_crystals INTEGER NOT NULL DEFAULT 0
  );
  -- PRD: по 3 бесплатных бустера каждого типа — и тем, кто уже играет
  INSERT INTO inventory (user_id, item, count)
    SELECT u.id, b.item, 3 FROM users u, (SELECT 'beamBomb' AS item UNION ALL SELECT 'rainbow' UNION ALL SELECT 'extraMoves'
      UNION ALL SELECT 'hammer' UNION ALL SELECT 'freeSwap' UNION ALL SELECT 'shuffle') b;`,
  // v4: remote config с историей; ходы и время попытки, сдвинутые конфигом (реплей должен совпасть)
  `CREATE TABLE remote_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL, created_at INTEGER NOT NULL, author_id INTEGER
  );
  ALTER TABLE attempts ADD COLUMN moves INTEGER;
  ALTER TABLE attempts ADD COLUMN time_limit INTEGER;`,
  // v5: мета — задания, календарь входа, колесо, сундуки эпизодов, карточки
  `ALTER TABLE users ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';`,
];

/** Версия схемы после всех миграций. */
export const SCHEMA_VERSION = MIGRATIONS.length;

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
  roomId: (r.room_id as string | null | undefined) ?? null,
  startBoosters: r.start_boosters ? (JSON.parse(String(r.start_boosters)) as Item[]) : [],
  extensions: Number(r.extensions ?? 0),
  moves: r.moves === null || r.moves === undefined ? null : Number(r.moves),
  timeLimit: r.time_limit === null || r.time_limit === undefined ? null : Number(r.time_limit),
});

const toConfig = (r: Row): ConfigRow => ({
  id: Number(r.id), json: String(r.json), createdAt: Number(r.created_at), authorId: r.author_id === null ? null : Number(r.author_id),
});

const toRoom = (r: Row): RoomRow => ({
  id: String(r.id),
  mode: r.mode as RoomMode,
  creatorId: Number(r.creator_id),
  creatorName: String(r.creator_name),
  levelId: Number(r.level_id),
  seed: Number(r.seed),
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  inlineMessageId: (r.inline_message_id as string | null) ?? null,
  gifts: Number(r.gifts),
});

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  /** path ':memory:' — для тестов. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  /**
   * Миграции по PRAGMA user_version: база на хостинге живая, CREATE IF NOT EXISTS не добавит колонку.
   * Каждая миграция — одна транзакция; первая идемпотентна (базы до миграций уже содержат её таблицы).
   */
  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
    MIGRATIONS.slice(version).forEach((sql, i) => {
      this.tx(() => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${version + i + 1}`);
      });
    });
  }

  get schemaVersion(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
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
      this.db.prepare(`INSERT INTO attempts (id, user_id, level_id, seed, assist, started_at, status, room_id, start_boosters, moves, time_limit)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`)
        .run(a.id, a.userId, a.levelId, a.seed, a.assist, a.startedAt, a.roomId,
          a.startBoosters.length > 0 ? JSON.stringify(a.startBoosters) : null, a.moves, a.timeLimit);
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

  async createRoom(r: RoomRow): Promise<void> {
    this.db.prepare(`INSERT INTO rooms (id, mode, creator_id, creator_name, level_id, seed, created_at, expires_at, inline_message_id, gifts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.mode, r.creatorId, r.creatorName, r.levelId, r.seed, r.createdAt, r.expiresAt, r.inlineMessageId, r.gifts);
  }

  async getRoom(id: string): Promise<RoomRow | null> {
    const r = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Row | undefined;
    return r ? toRoom(r) : null;
  }

  async setRoomMessage(id: string, inlineMessageId: string): Promise<void> {
    this.db.prepare('UPDATE rooms SET inline_message_id = ? WHERE id = ? AND inline_message_id IS NULL').run(inlineMessageId, id);
  }

  async countActiveRooms(creatorId: number, since: number): Promise<number> {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM rooms r WHERE r.creator_id = ? AND r.created_at >= ?
      AND (r.inline_message_id IS NOT NULL OR EXISTS (SELECT 1 FROM room_results x WHERE x.room_id = r.id))`).get(creatorId, since) as Row;
    return Number(r.n);
  }

  async countRoomAttempts(roomId: string, userId: number): Promise<number> {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE room_id = ? AND user_id = ?').get(roomId, userId) as Row;
    return Number(r.n);
  }

  async recordRoomResult(roomId: string, x: Omit<RoomResult, 'attempts'>, now: number): Promise<void> {
    this.db.prepare(`
      INSERT INTO room_results (room_id, user_id, first_name, best_score, stars, won, attempts, updated_at, boosted)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (room_id, user_id) DO UPDATE SET
        first_name = excluded.first_name,
        -- значок бустера — у того результата, что стоит в рейтинге (лучшего)
        boosted = CASE WHEN excluded.best_score > best_score THEN excluded.boosted ELSE boosted END,
        best_score = MAX(best_score, excluded.best_score),
        stars = MAX(stars, excluded.stars),
        won = MAX(won, excluded.won),
        attempts = attempts + 1,
        updated_at = excluded.updated_at
    `).run(roomId, x.userId, x.firstName, x.bestScore, x.stars, x.won ? 1 : 0, now, x.boosted ? 1 : 0);
  }

  async getRoomResults(roomId: string): Promise<RoomResult[]> {
    // при равных очках выше тот, кто набрал их раньше
    return (this.db.prepare('SELECT * FROM room_results WHERE room_id = ? ORDER BY best_score DESC, updated_at ASC').all(roomId) as Row[])
      .map((r) => ({
        userId: Number(r.user_id), firstName: String(r.first_name), bestScore: Number(r.best_score),
        stars: Number(r.stars), won: Number(r.won) === 1, attempts: Number(r.attempts), boosted: Number(r.boosted) === 1,
      }));
  }

  async addGift(roomId: string, giverId: number, now: number, maxGifts: number, giveLife: (l: LivesState) => LivesState): Promise<'ok' | 'already' | 'full'> {
    return this.tx(() => {
      const room = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Row | undefined;
      if (!room) return 'full';
      if (this.db.prepare('SELECT 1 FROM room_gifts WHERE room_id = ? AND giver_id = ?').get(roomId, giverId)) return 'already';
      if (Number(room.gifts) >= maxGifts) return 'full';
      this.db.prepare('INSERT INTO room_gifts (room_id, giver_id, ts) VALUES (?, ?, ?)').run(roomId, giverId, now);
      this.db.prepare('UPDATE rooms SET gifts = gifts + 1 WHERE id = ?').run(roomId);
      const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(room.creator_id)) as Row | undefined;
      if (u) {
        const l = giveLife(toUser(u).lives);
        this.db.prepare('UPDATE users SET lives = ?, lives_updated_at = ?, infinite_until = ? WHERE id = ?')
          .run(l.lives, l.updatedAt, l.infiniteUntil, Number(room.creator_id));
      }
      return 'ok';
    });
  }

  private readWallet(userId: number): Wallet {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
    if (!u) throw new Error(`no user ${userId}`);
    const items = Object.fromEntries(ITEMS.map((i) => [i, 0])) as Record<Item, number>;
    for (const r of this.db.prepare('SELECT item, count FROM inventory WHERE user_id = ?').all(userId) as Row[]) {
      if ((ITEMS as readonly string[]).includes(String(r.item))) items[r.item as Item] = Number(r.count);
    }
    return {
      crystals: Number(u.crystals), piggy: Number(u.piggy), items, starterUntil: Number(u.starter_until),
      starterBought: Number(u.starter_bought) === 1, lives: toUser(u).lives,
      meta: JSON.parse(String(u.meta ?? '{}')) as MetaState,
    };
  }

  private writeWallet(userId: number, w: WalletUpdate): void {
    const set: string[] = [];
    const args: (number | string)[] = [];
    const put = (col: string, v: number) => { set.push(`${col} = ?`); args.push(v); };
    if (w.crystals !== undefined) put('crystals', w.crystals);
    if (w.piggy !== undefined) put('piggy', w.piggy);
    if (w.starterUntil !== undefined) put('starter_until', w.starterUntil);
    if (w.starterBought !== undefined) put('starter_bought', w.starterBought ? 1 : 0);
    if (w.lives) {
      put('lives', w.lives.lives);
      put('lives_updated_at', w.lives.updatedAt);
      put('infinite_until', w.lives.infiniteUntil);
    }
    if (w.meta) {
      set.push('meta = ?');
      args.push(JSON.stringify(w.meta));
    }
    if (set.length > 0) this.db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...args, userId);
    for (const [item, count] of Object.entries(w.items ?? {})) {
      this.db.prepare(`INSERT INTO inventory (user_id, item, count) VALUES (?, ?, ?)
        ON CONFLICT (user_id, item) DO UPDATE SET count = excluded.count`).run(userId, item, count);
    }
  }

  async getWallet(userId: number): Promise<Wallet> {
    return this.readWallet(userId);
  }

  async transact(userId: number, fn: (w: Wallet) => WalletUpdate | null): Promise<Wallet | null> {
    return this.tx(() => {
      const update = fn(this.readWallet(userId));
      if (!update) return null;
      if ((update.crystals ?? 0) < 0 || Object.values(update.items ?? {}).some((n) => n! < 0)) {
        throw new Error('wallet would go negative');
      }
      this.writeWallet(userId, update);
      return this.readWallet(userId);
    });
  }

  async extendAttempt(attemptId: string, userId: number, priceFor: (extensions: number) => number) {
    return this.tx(() => {
      const a = this.db.prepare("SELECT extensions FROM attempts WHERE id = ? AND user_id = ? AND status = 'open'").get(attemptId, userId) as Row | undefined;
      if (!a) return { status: 'not_open' as const, price: 0, wallet: null };
      const price = priceFor(Number(a.extensions));
      const w = this.readWallet(userId);
      if (w.crystals < price) return { status: 'no_crystals' as const, price, wallet: w };
      this.writeWallet(userId, { crystals: w.crystals - price });
      this.db.prepare('UPDATE attempts SET extensions = extensions + 1 WHERE id = ?').run(attemptId);
      return { status: 'ok' as const, price, wallet: this.readWallet(userId) };
    });
  }

  async createInvoice(i: Omit<InvoiceRow, 'paidAt'>): Promise<void> {
    this.db.prepare('INSERT INTO invoices (id, user_id, product, stars, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(i.id, i.userId, i.product, i.stars, i.createdAt);
  }

  async getPayment(chargeId: string) {
    const r = this.db.prepare('SELECT * FROM payments WHERE charge_id = ?').get(chargeId) as Row | undefined;
    return r ? { userId: Number(r.user_id), product: r.product as ProductId, stars: Number(r.stars), refunded: r.refunded_at !== null } : null;
  }

  async getInvoice(id: string): Promise<InvoiceRow | null> {
    const r = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Row | undefined;
    return r ? {
      id: String(r.id), userId: Number(r.user_id), product: r.product as ProductId, stars: Number(r.stars),
      createdAt: Number(r.created_at), paidAt: r.paid_at === null ? null : Number(r.paid_at),
    } : null;
  }

  async recordPayment(p: { chargeId: string; invoiceId: string; userId: number; product: ProductId; stars: number; now: number },
    grant: (w: Wallet) => WalletUpdate): Promise<'ok' | 'duplicate'> {
    return this.tx(() => {
      if (this.db.prepare('SELECT 1 FROM payments WHERE charge_id = ?').get(p.chargeId)) return 'duplicate';
      const before = this.readWallet(p.userId);
      const update = grant(before);
      const granted = (update.crystals ?? before.crystals) - before.crystals;
      this.db.prepare('INSERT INTO payments (charge_id, invoice_id, user_id, product, stars, created_at, granted_crystals) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(p.chargeId, p.invoiceId, p.userId, p.product, p.stars, p.now, granted);
      this.db.prepare('UPDATE invoices SET paid_at = ? WHERE id = ?').run(p.now, p.invoiceId);
      this.writeWallet(p.userId, update);
      return 'ok';
    });
  }

  async refundPayment(chargeId: string, now: number, revoke: (w: Wallet, product: ProductId, grantedCrystals: number) => WalletUpdate) {
    return this.tx(() => {
      const r = this.db.prepare('SELECT * FROM payments WHERE charge_id = ?').get(chargeId) as Row | undefined;
      if (!r) return { status: 'not_found' as const };
      const userId = Number(r.user_id);
      if (r.refunded_at !== null) return { status: 'already' as const, userId };
      this.db.prepare('UPDATE payments SET refunded_at = ? WHERE charge_id = ?').run(now, chargeId);
      this.writeWallet(userId, revoke(this.readWallet(userId), r.product as ProductId, Number(r.granted_crystals)));
      return { status: 'ok' as const, userId };
    });
  }

  async pruneRooms(now: number): Promise<number> {
    const res = this.db.prepare(`DELETE FROM rooms WHERE expires_at < ? AND inline_message_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM room_results x WHERE x.room_id = rooms.id)`).run(now);
    return Number(res.changes);
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

  async getConfig(): Promise<ConfigRow | null> {
    const r = this.db.prepare('SELECT * FROM remote_config ORDER BY id DESC LIMIT 1').get() as Row | undefined;
    return r ? toConfig(r) : null;
  }

  async saveConfig(json: string, now: number, authorId: number | null): Promise<ConfigRow> {
    const res = this.db.prepare('INSERT INTO remote_config (json, created_at, author_id) VALUES (?, ?, ?)').run(json, now, authorId);
    return { id: Number(res.lastInsertRowid), json, createdAt: now, authorId };
  }

  async configHistory(limit: number): Promise<ConfigRow[]> {
    return (this.db.prepare('SELECT * FROM remote_config ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(toConfig);
  }

  /** Итоги каждого игрока (для разбивки по вариантам экспериментов). Только SQLite — для скрипта report. */
  userOutcomes(now: number): UserOutcome[] {
    const day = 24 * 3600_000;
    return (this.db.prepare(`
      SELECT u.id, u.created_at, u.max_level,
        (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.name = 'level_win') AS wins,
        (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.name = 'level_fail') AS fails,
        (SELECT COALESCE(SUM(p.stars), 0) FROM payments p WHERE p.user_id = u.id AND p.refunded_at IS NULL) AS stars,
        (u.created_at <= ? AND EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name = 'session_start'
          AND e.ts >= u.created_at + ? AND e.ts < u.created_at + ?)) AS d1
      FROM users u`).all(now - 2 * day, day, 2 * day) as Row[]).map((r) => ({
      userId: Number(r.id), createdAt: Number(r.created_at), maxLevel: Number(r.max_level),
      wins: Number(r.wins), fails: Number(r.fails), starsPaid: Number(r.stars), returnedD1: Number(r.d1) === 1,
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
        cleanGames: 0, cleanWinRate: 0,
      };
    });
    const clean = new Map((this.db.prepare(`
      SELECT level_id, COUNT(*) AS games, SUM(status = 'won') AS wins FROM attempts
      WHERE room_id IS NULL AND status IN ('won', 'lost') AND assist = 0 AND start_boosters IS NULL AND extensions = 0
        AND moves IS NULL AND time_limit IS NULL AND (swaps IS NULL OR swaps NOT LIKE '%"booster"%')
      GROUP BY level_id`).all() as Row[]).map((r) => [Number(r.level_id), { games: Number(r.games), wins: Number(r.wins) }]));
    for (const l of levels) {
      const c = clean.get(l.levelId);
      Object.assign(l, { cleanGames: c?.games ?? 0, cleanWinRate: c && c.games > 0 ? c.wins / c.games : 0 });
    }
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
