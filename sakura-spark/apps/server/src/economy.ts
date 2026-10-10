/**
 * Экономика (PRD, «Монетизация» и «Экономика и сложность»). Все цены — здесь, в одном объекте:
 * remote config (этап 13) переопределяет его без релиза клиента.
 */

/** Предметы склада: бустеры перед уровнем и во время игры. */
export const ITEMS = ['beamBomb', 'rainbow', 'extraMoves', 'hammer', 'freeSwap', 'shuffle'] as const;
export type Item = (typeof ITEMS)[number];
export const START_ITEMS: readonly Item[] = ['beamBomb', 'rainbow', 'extraMoves'];
export const GAME_ITEMS: readonly Item[] = ['hammer', 'freeSwap', 'shuffle'];

/** Пакеты, которые покупаются за Telegram Stars. */
export type ProductId = 'pack10' | 'pack50' | 'pack100' | 'pack250' | 'pack500' | 'starter' | 'piggy';

export interface Economy {
  /** Цены бустеров в кристаллах. */
  readonly itemPrices: Readonly<Record<Item, number>>;
  /** Полный запас жизней. */
  readonly refillLives: number;
  /** «+5 ходов»: цена растёт в пределах одного уровня. */
  readonly extendPrices: readonly number[];
  readonly extendMoves: number;
  /** PRD: 3 бесплатных бустера каждого типа на старте. */
  readonly freeItemsOnInstall: number;
  /** Пакеты кристаллов за Stars: кристаллы, цена, бонус для витрины (%). */
  readonly packs: Readonly<Record<'pack10' | 'pack50' | 'pack100' | 'pack250' | 'pack500', { crystals: number; stars: number; bonus: number; title: string }>>;
  /** Стартовый пак: один раз после уровня 15, действует 48 ч. */
  readonly starter: { readonly stars: number; readonly crystals: number; readonly items: Partial<Record<Item, number>>; readonly infiniteLivesMs: number; readonly afterLevel: number; readonly windowMs: number };
  /** Копилка: копится за победы, разбить за Stars. */
  readonly piggy: { readonly perWin: number; readonly max: number; readonly stars: number; readonly minToBreak: number };
  /** Мета: смена игрового дня (часовой пояс), доп. спины колеса, помощь застрявшему. */
  readonly meta: { readonly dayOffsetHours: number; readonly wheelSpinPrice: number; readonly wheelExtraSpins: number; readonly stuckDays: number };
  /** Соц: подарки жизней в день, ключи района, реферальная награда, пуши в день. */
  readonly social: {
    readonly giftsPerDay: number; readonly keysNeeded: number; readonly gateWaitHours: number; readonly gatePrice: number;
    readonly referralCrystals: number; readonly referralLevel: number; readonly pushesPerDay: number;
  };
}

export const DEFAULT_ECONOMY: Economy = {
  itemPrices: { beamBomb: 9, rainbow: 12, extraMoves: 9, hammer: 15, freeSwap: 19, shuffle: 9 },
  refillLives: 12,
  extendPrices: [9, 15, 25],
  extendMoves: 5,
  freeItemsOnInstall: 3,
  packs: {
    pack10: { crystals: 10, stars: 50, bonus: 0, title: 'Горсть кристаллов' },
    pack50: { crystals: 50, stars: 225, bonus: 10, title: 'Мешочек кристаллов' },
    pack100: { crystals: 100, stars: 425, bonus: 20, title: 'Шкатулка кристаллов' },
    pack250: { crystals: 250, stars: 1000, bonus: 30, title: 'Сундук кристаллов' },
    pack500: { crystals: 500, stars: 1900, bonus: 40, title: 'Сокровищница' },
  },
  starter: {
    stars: 50, crystals: 30, items: { hammer: 1, freeSwap: 1, shuffle: 1 },
    infiniteLivesMs: 2 * 3600_000, afterLevel: 15, windowMs: 48 * 3600_000,
  },
  piggy: { perWin: 3, max: 120, stars: 150, minToBreak: 30 },
  meta: { dayOffsetHours: 3, wheelSpinPrice: 9, wheelExtraSpins: 3, stuckDays: 3 },
  social: { giftsPerDay: 5, keysNeeded: 3, gateWaitHours: 24, gatePrice: 29, referralCrystals: 20, referralLevel: 10, pushesPerDay: 2 },
};

/** Цена n-й докупки ходов в попытке (0 — первая); дальше последней ступени — последняя цена. */
export function extendPrice(e: Economy, already: number): number {
  return e.extendPrices[Math.min(already, e.extendPrices.length - 1)]!;
}

export const isItem = (v: unknown): v is Item => typeof v === 'string' && (ITEMS as readonly string[]).includes(v);
