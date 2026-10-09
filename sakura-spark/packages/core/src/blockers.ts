import type { Pos } from './types.ts';

/**
 * Блокеры (PRD, Core gameplay). Все, кроме лиан, занимают клетку целиком — фишки в ней нет,
 * а падающие фишки пролетают сквозь неё, как сквозь дыру.
 *
 * - ice — лёд, 1–2 слоя: слой снимают соседний матч или взрыв.
 * - fog — туман Курогири, 1 слой: как лёд, но если за ход не снят ни один туман,
 *   он расползается на соседнюю фишку.
 * - chest — запертый сундук, 1–2 замка: как лёд; открытый оставляет луч или бомбу.
 * - daifuku — шоколадный дайфуку, 1–2 слоя: соседние матчи не действуют, только спецфишки.
 * - vines — лианы глициний поверх фишки: фишку нельзя двигать, она не падает, но участвует
 *   в матчах; удар снимает лианы, фишка остаётся.
 */
export type Blocker =
  | { readonly kind: 'ice'; readonly layers: 1 | 2 }
  | { readonly kind: 'fog' }
  | { readonly kind: 'chest'; readonly layers: 1 | 2 }
  | { readonly kind: 'daifuku'; readonly layers: 1 | 2 }
  | { readonly kind: 'vines' };

export type BlockerKind = Blocker['kind'];

/** Портал: фишка, упавшая во вход, продолжает падение из выхода. */
export interface Portal {
  readonly from: Pos;
  readonly to: Pos;
}

/** Символы сетки блокеров в JSON уровня. */
export const BLOCKER_CHARS: Readonly<Record<string, Blocker | null>> = {
  '.': null,
  _: null,
  i: { kind: 'ice', layers: 1 },
  I: { kind: 'ice', layers: 2 },
  f: { kind: 'fog' },
  k: { kind: 'chest', layers: 1 },
  K: { kind: 'chest', layers: 2 },
  m: { kind: 'daifuku', layers: 1 },
  M: { kind: 'daifuku', layers: 2 },
  v: { kind: 'vines' },
};

export function occupiesCell(b: Blocker | null): boolean {
  return b !== null && b.kind !== 'vines';
}

/** Снять один слой. null — блокер исчез. */
export function damage(b: Blocker): Blocker | null {
  if (b.kind === 'vines' || b.kind === 'fog') return null;
  if (b.layers === 1) return null;
  return { ...b, layers: 1 };
}

export function layersOf(b: Blocker | null): number {
  if (!b) return 0;
  return 'layers' in b ? b.layers : 1;
}
