/** Карта-тропа: эпизод = район Хоширо = 15 уровней (PRD, «Мета-прогрессия»). */
export const LEVELS_PER_EPISODE = 15;

export interface Episode {
  readonly id: number;
  readonly name: string;
  readonly from: number;
  readonly to: number;
  /** Оттенок района на карте. */
  readonly tint: number;
}

const DISTRICTS = [
  { name: 'Храмовый холм', tint: 0xffc2d9 },
  { name: 'Торговая улица', tint: 0xffd9a8 },
  { name: 'Порт фонарей', tint: 0xb9dcff },
  { name: 'Зимний квартал', tint: 0xd6e6ff },
  { name: 'Небесный мост', tint: 0xd9c8ff },
] as const;

export function episodes(levelCount: number): Episode[] {
  const n = Math.ceil(levelCount / LEVELS_PER_EPISODE);
  return Array.from({ length: n }, (_, i) => {
    const d = DISTRICTS[i % DISTRICTS.length]!;
    const from = i * LEVELS_PER_EPISODE + 1;
    return { id: i + 1, name: i < DISTRICTS.length ? d.name : `${d.name} ${Math.floor(i / DISTRICTS.length) + 1}`, from, to: Math.min(levelCount, from + LEVELS_PER_EPISODE - 1), tint: d.tint };
  });
}

export const episodeOf = (levelId: number): number => Math.ceil(levelId / LEVELS_PER_EPISODE);

export type NodeState = 'done' | 'current' | 'locked';

/** done — пройден (есть звёзды), current — самый дальний открытый, locked — ещё закрыт. */
export function nodeState(levelId: number, maxLevel: number, stars: number): NodeState {
  if (levelId > maxLevel) return 'locked';
  return stars > 0 ? 'done' : 'current';
}

/** Район «зажжён», когда пройдены все его уровни: там расцветает сакура. */
export function episodeLit(e: Episode, maxLevel: number): boolean {
  return maxLevel > e.to;
}

export interface MapGeometry {
  /** Высота мира карты. */
  readonly height: number;
  readonly spacing: number;
  readonly headerHeight: number;
  /** Центр узла уровня в координатах мира (уровень 1 внизу, тропа петляет вверх). */
  node(levelId: number): { x: number; y: number };
  /** Полоса района: верх и низ в координатах мира. */
  band(e: Episode): { top: number; bottom: number };
}

export function mapGeometry(levelCount: number, width: number, k = 1): MapGeometry {
  const spacing = 96 * k;
  const headerHeight = 72 * k;
  const bottomPad = 140 * k;
  const topPad = 120 * k;
  const amplitude = Math.min(width * 0.28, 150 * k);
  const eps = Math.ceil(levelCount / LEVELS_PER_EPISODE);
  const height = topPad + levelCount * spacing + eps * headerHeight + bottomPad;
  const yOf = (levelId: number) => height - bottomPad - (levelId - 1) * spacing - (episodeOf(levelId) - 1) * headerHeight;
  return {
    height,
    spacing,
    headerHeight,
    node: (levelId) => ({ x: width / 2 + Math.sin((levelId - 1) * 0.85) * amplitude, y: yOf(levelId) }),
    band: (e) => ({ top: yOf(e.to) - spacing / 2 - headerHeight, bottom: yOf(e.from) + spacing / 2 }),
  };
}

export function starsInEpisode(e: Episode, stars: Readonly<Record<string, { stars: number }>>): number {
  let sum = 0;
  for (let id = e.from; id <= e.to; id++) sum += stars[id]?.stars ?? 0;
  return sum;
}
