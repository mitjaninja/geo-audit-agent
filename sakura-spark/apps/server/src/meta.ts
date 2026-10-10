/**
 * Мета (PRD, «Мета-прогрессия», «Ежедневный вход», «Ежедневное колесо», «Защита от выгорания»):
 * сундуки эпизодов, 3 ежедневных задания, 7-дневный календарь входа, колесо, бустер застрявшему игроку.
 *
 * Чистые функции над MetaState — JSON в строке игрока. Сервис меняет его вместе с кошельком
 * одной транзакцией (Store.transact), поэтому награда не выдаётся дважды.
 *
 * Бюджет бесплатных кристаллов по PRD — 2–5 в неделю: календарь даёт 2, колесо в среднем ~1,5,
 * сундуки — по 5 за эпизод (эпизод — 1–2 недели). Задания дают только бустеры и жизни.
 */
import { createHash } from 'node:crypto';
import type { Item } from './economy.ts';
import type { Wallet, WalletUpdate } from './store.ts';

export interface Reward {
  readonly crystals?: number;
  readonly items?: Partial<Record<Item, number>>;
  /** Бесконечные жизни на столько миллисекунд. */
  readonly infiniteLivesMs?: number;
  readonly card?: string;
}

export const TASK_KINDS = ['win', 'stars', 'threeStars', 'booster', 'score', 'room'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface TaskState {
  readonly kind: TaskKind;
  readonly target: number;
  readonly progress: number;
  readonly claimed: boolean;
  readonly reward: Reward;
}

export interface MetaState {
  /** День последней награды календаря и сколько всего наград получено (позиция в 7-дневном цикле). */
  readonly loginDay?: number;
  readonly loginCount?: number;
  readonly wheelDay?: number;
  /** Спинов за wheelDay, включая бесплатный. */
  readonly wheelSpins?: number;
  readonly taskDay?: number;
  readonly tasks?: readonly TaskState[];
  /** Открытые сундуки: «эпизод:порог». */
  readonly chests?: readonly string[];
  readonly cards?: Readonly<Record<string, number>>;
  /** Когда игрок открыл свой текущий последний уровень, и на каком уровне уже получил помощь. */
  readonly maxLevelAt?: number;
  readonly stuckGift?: number;
  /**
   * Ворота районов (PRD «Помощь в разблокировке»): когда игрок дошёл до первого уровня района,
   * кто из друзей дал ключ, открыт ли район (ключи, ожидание или кристаллы).
   */
  readonly gates?: Readonly<Record<string, { readonly reachedAt: number; readonly keys: readonly number[]; readonly open?: boolean }>>;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const LEVELS_PER_EPISODE = 15;

/** Номер игрового дня. Смена дня — в полночь по смещению (по умолчанию UTC+3, Москва). */
export const dayNumber = (now: number, offsetHours: number) => Math.floor((now + offsetHours * HOUR) / DAY);

// ---------- карточки персонажей ----------

/** Эксклюзивные карточки 7-го дня календаря — по одной за неделю, по кругу. */
export const CARDS = [
  { id: 'mika_yukata', title: 'Мика в юкате' },
  { id: 'pon_lantern', title: 'Пон с фонариком' },
  { id: 'ren_festival', title: 'Рэн на фестивале' },
  { id: 'setsu_moon', title: 'Сэцу под луной' },
  { id: 'mika_sakura', title: 'Мика под сакурой' },
  { id: 'ren_market', title: 'Рэн на рынке' },
  { id: 'setsu_snow', title: 'Сэцу в снегопад' },
] as const;

// ---------- календарь входа ----------

export const CALENDAR: readonly Reward[] = [
  { items: { shuffle: 1 } },
  { infiniteLivesMs: 30 * 60_000 },
  { items: { hammer: 1 } },
  { items: { beamBomb: 1 } },
  { crystals: 2 },
  { items: { rainbow: 1 } },
  { items: { freeSwap: 1 } }, // + карточка недели
];

/** Награда n-го входа (n с 1). Седьмой день — ещё и карточка недели; все собраны — 3 кристалла вместо неё. */
export function calendarReward(n: number, cards: Readonly<Record<string, number>>): Reward {
  const base = CALENDAR[(n - 1) % 7]!;
  if (n % 7 !== 0) return base;
  const week = Math.floor((n - 1) / 7);
  const card = CARDS[week % CARDS.length]!;
  if (week >= CARDS.length && CARDS.every((c) => (cards[c.id] ?? 0) > 0)) return { ...base, crystals: 3 };
  return { ...base, card: card.id };
}

// ---------- ежедневные задания ----------

const TASK_TARGETS: Readonly<Record<TaskKind, readonly number[]>> = {
  win: [2, 3],
  stars: [4, 6],
  threeStars: [1],
  booster: [1, 2],
  score: [15_000, 25_000],
  room: [1],
};

const TASK_REWARDS: readonly Reward[] = [
  { items: { hammer: 1 } },
  { items: { shuffle: 1 } },
  { items: { beamBomb: 1 } },
  { infiniteLivesMs: 30 * 60_000 },
  { items: { freeSwap: 1 } },
  { items: { extraMoves: 1 } },
];

const hash = (s: string) => createHash('sha256').update(s).digest();

/** Три разных задания на день — детерминированно по игроку и дню (без хранения, пока игрок не зашёл). */
export function dailyTasks(userId: number, day: number): TaskState[] {
  const h = hash(`tasks:${userId}:${day}`);
  const kinds = [...TASK_KINDS];
  const out: TaskState[] = [];
  for (let i = 0; i < 3; i++) {
    const kind = kinds.splice(h[i]! % kinds.length, 1)[0]!;
    const targets = TASK_TARGETS[kind];
    out.push({ kind, target: targets[h[3 + i]! % targets.length]!, progress: 0, claimed: false, reward: TASK_REWARDS[h[6 + i]! % TASK_REWARDS.length]! });
  }
  return out;
}

/** Задания на сегодня: вчерашние сгорают. */
export function todayTasks(meta: MetaState, userId: number, day: number): readonly TaskState[] {
  return meta.taskDay === day && meta.tasks ? meta.tasks : dailyTasks(userId, day);
}

export function progressTasks(meta: MetaState, userId: number, day: number, deltas: Partial<Record<TaskKind, number>>): MetaState {
  const tasks = todayTasks(meta, userId, day).map((t) => {
    const d = deltas[t.kind] ?? 0;
    return d > 0 && !t.claimed ? { ...t, progress: Math.min(t.target, t.progress + d) } : t;
  });
  return { ...meta, taskDay: day, tasks };
}

// ---------- сундуки эпизодов ----------

export const CHESTS: Readonly<Record<30 | 45, Reward>> = {
  30: { crystals: 2, items: { hammer: 1, beamBomb: 1 } },
  45: { crystals: 3, items: { rainbow: 1, freeSwap: 1, shuffle: 1 } },
};
export const CHEST_TIERS = [30, 45] as const;
export type ChestTier = (typeof CHEST_TIERS)[number];

export const episodeOf = (levelId: number) => Math.ceil(levelId / LEVELS_PER_EPISODE);

// ---------- колесо ----------

/** Призы и веса (сумма 100 — веса и есть проценты; клиент показывает их игроку). */
export const WHEEL: readonly { readonly id: string; readonly weight: number; readonly reward: Reward }[] = [
  { id: 'hammer', weight: 12, reward: { items: { hammer: 1 } } },
  { id: 'freeSwap', weight: 8, reward: { items: { freeSwap: 1 } } },
  { id: 'shuffle', weight: 21, reward: { items: { shuffle: 1 } } },
  { id: 'beamBomb', weight: 15, reward: { items: { beamBomb: 1 } } },
  { id: 'rainbow', weight: 10, reward: { items: { rainbow: 1 } } },
  { id: 'extraMoves', weight: 15, reward: { items: { extraMoves: 1 } } },
  { id: 'lives', weight: 14, reward: { infiniteLivesMs: 30 * 60_000 } },
  { id: 'crystals3', weight: 4, reward: { crystals: 3 } },
  { id: 'crystals10', weight: 1, reward: { crystals: 10 } },
];

/** r ∈ [0, 1) → приз. */
export function wheelPrize(r: number): number {
  const total = WHEEL.reduce((s, p) => s + p.weight, 0);
  let x = r * total;
  for (let i = 0; i < WHEEL.length; i++) {
    x -= WHEEL[i]!.weight;
    if (x < 0) return i;
  }
  return WHEEL.length - 1;
}

// ---------- выдача ----------

/** Начислить награду: новые абсолютные значения кошелька (карточка — в meta, её добавляет вызывающий). */
export function grant(w: Wallet, r: Reward, now: number): WalletUpdate {
  return {
    ...(r.crystals ? { crystals: w.crystals + r.crystals } : {}),
    ...(r.items ? { items: Object.fromEntries((Object.entries(r.items) as [Item, number][]).map(([i, n]) => [i, w.items[i] + n])) } : {}),
    ...(r.infiniteLivesMs ? { lives: { ...w.lives, infiniteUntil: Math.max(now, w.lives.infiniteUntil) + r.infiniteLivesMs } } : {}),
  };
}

export function addCard(meta: MetaState, r: Reward): MetaState {
  if (!r.card) return meta;
  const cards = meta.cards ?? {};
  return { ...meta, cards: { ...cards, [r.card]: (cards[r.card] ?? 0) + 1 } };
}
