import type { Board } from './board.ts';
import { hasMatchAt } from './match.ts';
import type { Pos, Swap } from './types.ts';

export function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

export function swapPieces(board: Board, { a, b }: Swap): void {
  const pa = board.get(a);
  board.set(a, board.get(b));
  board.set(b, pa);
}

/** Свап даёт хотя бы одну тройку. Поле после проверки не меняется. */
export function swapMakesMatch(board: Board, swap: Swap): boolean {
  if (!board.inBounds(swap.a) || !board.inBounds(swap.b) || !isAdjacent(swap.a, swap.b)) return false;
  const pa = board.get(swap.a);
  const pb = board.get(swap.b);
  if (!pa || !pb || pa.color === pb.color) return false;
  swapPieces(board, swap);
  const ok = hasMatchAt(board, swap.a) || hasMatchAt(board, swap.b);
  swapPieces(board, swap);
  return ok;
}

/** Все ходы, дающие матч. Каждая пара клеток — один раз (вправо и вниз). */
export function findValidSwaps(board: Board): Swap[] {
  const result: Swap[] = [];
  for (let row = 0; row < board.height; row++) {
    for (let col = 0; col < board.width; col++) {
      const a = { row, col };
      for (const b of [{ row, col: col + 1 }, { row: row + 1, col }]) {
        if (swapMakesMatch(board, { a, b })) result.push({ a, b });
      }
    }
  }
  return result;
}
