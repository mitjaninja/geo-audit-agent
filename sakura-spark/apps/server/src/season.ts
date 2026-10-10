/**
 * Фаза 4 PRD: «Фестивальный пропуск» (30 дней, 30 ступеней, бесплатная дорожка и премиум по подписке Stars),
 * коллекция карточек персонажей (сет даёт рамку аватара) и сезонные фестивали с временными уровнями.
 * Только таблицы и чистые функции — состояние игрока лежит в MetaState.
 */
import { CARDS } from './meta.ts';
import type { Reward } from './meta.ts';

const DAY = 86_400_000;
export const SEASON_DAYS = 30;
/** Начало первого сезона — полночь 1 января 2026 по Москве. */
export const SEASON_EPOCH = Date.UTC(2025, 11, 31, 21);

export function seasonOf(now: number): { index: number; startsAt: number; endsAt: number } {
  const index = Math.floor((now - SEASON_EPOCH) / (SEASON_DAYS * DAY));
  const startsAt = SEASON_EPOCH + index * SEASON_DAYS * DAY;
  return { index, startsAt, endsAt: startsAt + SEASON_DAYS * DAY };
}

// ---------- пропуск ----------

export const PASS_TIERS_COUNT = 30;
/** Очки: победа на карте — 1 (+1 за три звезды), сыгранная комната чата — 1. 3 очка — ступень. */
export const POINTS_PER_TIER = 3;

/** Ступени: бесплатная дорожка — бустеры и жизни, кристаллов мало (бюджет PRD); премиум — щедрее и косметика. */
export const PASS_TIERS: readonly { readonly free: Reward; readonly premium: Reward }[] = Array.from({ length: PASS_TIERS_COUNT }, (_, i) => {
  const tier = i + 1;
  const cycle = ['shuffle', 'hammer', 'beamBomb', 'freeSwap', 'rainbow', 'extraMoves'] as const;
  const item = cycle[i % cycle.length]!;
  const free: Reward = tier % 10 === 0 ? { crystals: tier === 30 ? 3 : 2 }
    : tier % 4 === 0 ? { infiniteLivesMs: 30 * 60_000 } : { items: { [item]: 1 } };
  const premium: Reward = tier === 30 ? { crystals: 20, frame: 'gold' }
    : tier === 20 ? { card: 'mika_kimono', items: { rainbow: 2 } }
      : tier === 10 ? { frame: 'festival', crystals: 5 }
        : tier % 5 === 0 ? { crystals: 10 }
          : { items: { [cycle[(i + 3) % cycle.length]!]: 2 }, ...(tier % 3 === 0 ? { infiniteLivesMs: 60 * 60_000 } : {}) };
  return { free, premium };
});

// ---------- карточки и рамки ----------

export const FRAMES: Readonly<Record<string, { readonly title: string; readonly color: number }>> = {
  sakura: { title: 'Сакура', color: 0xff8fc0 },
  lantern: { title: 'Фонарь', color: 0xffa94d },
  festival: { title: 'Фестиваль', color: 0x9b7bff },
  gold: { title: 'Золото', color: 0xffc93c },
  hanami: { title: 'Ханами', color: 0xffb7d5 },
  tanabata: { title: 'Танабата', color: 0x6fb6ff },
  halloween: { title: 'Хэллоуин', color: 0xff7a1a },
  newyear: { title: 'Новый год', color: 0x5fd3c7 },
};

export const CARD_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(CARDS.map((c) => [c.id, c.title])),
  temple_fox: 'Лис храмового холма', street_cat: 'Кот с торговой улицы', port_crane: 'Журавль из порта',
  winter_owl: 'Сова зимнего квартала', bridge_dragon: 'Дракон небесного моста', fountain_koi: 'Карп из сада фонтанов',
  bamboo_panda: 'Панда бамбуковой рощи', mika_kimono: 'Мика в праздничном кимоно',
  hanami_mika: 'Мика на ханами', tanabata_ren: 'Рэн и звёздные ленты', halloween_pon: 'Пон в маске тыквы', newyear_setsu: 'Сэцу и новогодний фонарь',
};

/** Сеты: собрал все карточки — рамка аватара (PRD «Коллекция карточек персонажей»). */
export const CARD_SETS: readonly { readonly id: string; readonly title: string; readonly cards: readonly string[]; readonly frame: string }[] = [
  { id: 'festival', title: 'Фестивальная неделя', cards: CARDS.map((c) => c.id), frame: 'sakura' },
  { id: 'districts', title: 'Жители Хоширо', cards: ['temple_fox', 'street_cat', 'port_crane', 'winter_owl', 'bridge_dragon', 'fountain_koi', 'bamboo_panda'], frame: 'lantern' },
];

/** Шанс, что победа на карте даст карточку сета «Жители Хоширо». */
export const CARD_DROP_CHANCE = 0.06;

/** Новые рамки за собранные сеты (которых у игрока ещё нет). */
export function completedFrames(cards: Readonly<Record<string, number>>, frames: readonly string[]): string[] {
  return CARD_SETS.filter((s) => s.cards.every((c) => (cards[c] ?? 0) > 0) && !frames.includes(s.frame)).map((s) => s.frame);
}

// ---------- сезонные фестивали ----------

export interface Festival {
  readonly id: string;
  readonly title: string;
  /** Месяц (1–12) и день начала и конца включительно; конец может быть в следующем году. */
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** Уровни фестиваля: копии уровней карты (уже настроенных ботом) с праздничным вступлением. */
  readonly sourceLevels: readonly number[];
  readonly intro: string;
  readonly card: string;
  readonly frame: string;
}

export const FESTIVALS: readonly Festival[] = [
  { id: 'hanami', title: 'Ханами', from: [3, 25], to: [4, 10], sourceLevels: [33, 41, 52, 64, 76], intro: 'Сакура цветёт! Пять праздничных уровней под розовым дождём лепестков.', card: 'hanami_mika', frame: 'hanami' },
  { id: 'tanabata', title: 'Танабата', from: [7, 1], to: [7, 10], sourceLevels: [38, 47, 56, 68, 83], intro: 'Праздник звёзд: загадай желание на ленте и пройди пять звёздных уровней.', card: 'tanabata_ren', frame: 'tanabata' },
  { id: 'halloween', title: 'Хэллоуин', from: [10, 25], to: [11, 2], sourceLevels: [36, 44, 53, 62, 71], intro: 'Курогири надел маску тыквы! Пять жутко весёлых уровней — не бойся.', card: 'halloween_pon', frame: 'halloween' },
  { id: 'newyear', title: 'Новый год', from: [12, 25], to: [1, 8], sourceLevels: [39, 48, 57, 66, 78], intro: 'Новогодние фонари зажигаются над Хоширо. Пройди пять праздничных уровней!', card: 'newyear_setsu', frame: 'newyear' },
];

export const FESTIVAL_LEVEL_BASE = 1000;
/** id уровня фестиваля: 1000 + 10·номер фестиваля + шаг (1–5). Вне карты — прогресс карты не меняют. */
export const festivalLevelId = (festivalIndex: number, step: number) => FESTIVAL_LEVEL_BASE + festivalIndex * 10 + step;
export const isFestivalLevel = (id: number) => id > FESTIVAL_LEVEL_BASE;

/** Фестиваль на дату (по Москве); override из remote config: id фестиваля — включить сейчас, 'off' — выключить. */
export function activeFestival(now: number, override?: string): { festival: Festival; index: number; endsAt: number } | null {
  if (override === 'off') return null;
  const msk = new Date(now + 3 * 3600_000);
  const md = (m: number, d: number) => m * 100 + d;
  const today = md(msk.getUTCMonth() + 1, msk.getUTCDate());
  for (const [index, f] of FESTIVALS.entries()) {
    const from = md(...f.from);
    const to = md(...f.to);
    const on = override ? override === f.id : from <= to ? today >= from && today <= to : today >= from || today <= to;
    if (!on) continue;
    // конец — полночь после последнего дня (по Москве)
    const year = msk.getUTCFullYear() + (from > to && today >= from ? 1 : 0);
    const endsAt = Date.UTC(year, f.to[0] - 1, f.to[1] + 1) - 3 * 3600_000;
    return { festival: f, index, endsAt: override ? now + 7 * DAY : endsAt };
  }
  return null;
}

/** Награда за каждый пройденный уровень фестиваля и за финал. */
export const FESTIVAL_STEP: Reward = { items: { shuffle: 1 } };
export const festivalFinal = (f: Festival): Reward => ({ card: f.card, frame: f.frame, crystals: 5 });
