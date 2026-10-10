import { isAdjacent } from '@sakura/core';
import type { Pos, Swap } from '@sakura/core';

/**
 * Свайп: от клетки нажатия в сторону наибольшего смещения, если палец ушёл дальше порога.
 * Порог — доля клетки, чтобы дрожание пальца не считалось ходом.
 */
export function swipeToSwap(from: Pos, dx: number, dy: number, cell: number, threshold = 0.35): Swap | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * threshold) return null;
  const to = Math.abs(dx) >= Math.abs(dy)
    ? { row: from.row, col: from.col + Math.sign(dx) }
    : { row: from.row + Math.sign(dy), col: from.col };
  return { a: from, b: to };
}

export type TapResult =
  | { readonly kind: 'select'; readonly at: Pos }
  | { readonly kind: 'deselect' }
  | { readonly kind: 'swap'; readonly swap: Swap };

/** Тап-тап: первый тап выбирает фишку, тап по соседней — ход, по той же — снять выбор, по дальней — выбрать её. */
export function tap(selected: Pos | null, at: Pos): TapResult {
  if (!selected) return { kind: 'select', at };
  if (selected.row === at.row && selected.col === at.col) return { kind: 'deselect' };
  if (isAdjacent(selected, at)) return { kind: 'swap', swap: { a: selected, b: at } };
  return { kind: 'select', at };
}
