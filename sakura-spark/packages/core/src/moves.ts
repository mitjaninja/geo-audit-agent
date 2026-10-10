import type { Board } from './board.ts';
import { hasMatchAt } from './match.ts';
import { comboKind } from './specials.ts';
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
/** Обе клетки существуют, соседние и фишки в них подвижны (не под лианами). */
export function canSwapCells(board: Board, swap: Swap): boolean {
  return board.isMovable(swap.a) && board.isMovable(swap.b) && isAdjacent(swap.a, swap.b);
}

export function swapMakesMatch(board: Board, swap: Swap): boolean {
  if (!canSwapCells(board, swap)) return false;
  const pa = board.get(swap.a);
  const pb = board.get(swap.b);
  if (!pa || !pb || (pa.color !== null && pa.color === pb.color)) return false;
  swapPieces(board, swap);
  const ok = hasMatchAt(board, swap.a) || hasMatchAt(board, swap.b);
  swapPieces(board, swap);
  return ok;
}

/** Свап двух спецфишек или радуги с любой фишкой — комбо, матч не нужен. */
export function swapIsCombo(board: Board, swap: Swap): boolean {
  if (!canSwapCells(board, swap)) return false;
  const pa = board.get(swap.a);
  const pb = board.get(swap.b);
  return !!pa && !!pb && comboKind(pa, pb) !== null;
}

export function isValidSwap(board: Board, swap: Swap): boolean {
  return swapIsCombo(board, swap) || swapMakesMatch(board, swap);
}

/** Все допустимые ходы (матч или комбо). Каждая пара клеток — один раз (вправо и вниз). */
export function findValidSwaps(board: Board): Swap[] {
  const result: Swap[] = [];
  for (let row = 0; row < board.height; row++) {
    for (let col = 0; col < board.width; col++) {
      const a = { row, col };
      for (const b of [{ row, col: col + 1 }, { row: row + 1, col }]) {
        if (isValidSwap(board, { a, b })) result.push({ a, b });
      }
    }
  }
  return result;
}
