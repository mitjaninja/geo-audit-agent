import type { Board } from './board.ts';
import type { ComboKind, MatchGroup, Piece, Pos, Special } from './types.ts';

export type MadeSpecial = 'lineH' | 'lineV' | 'bomb' | 'rainbow';

const key = (p: Pos) => `${p.row},${p.col}`;

/** Какую спецфишку даёт группа. Приоритет: 5+ → радуга, L/T → бомба, 4 → луч. */
export function specialForGroup(g: MatchGroup): MadeSpecial | null {
  if (g.longestLine >= 5) return 'rainbow';
  if (g.isCross) return 'bomb';
  if (g.longestLine === 4) {
    const horizontal = g.cells.every((p) => p.row === g.cells[0]!.row);
    return horizontal ? 'lineV' : 'lineH';
  }
  return null;
}

/**
 * Клетка, где родится спецфишка: клетка хода, если она в группе;
 * иначе пересечение L/T или середина линии — детерминированно.
 */
export function anchorFor(g: MatchGroup, preferred: readonly Pos[]): Pos {
  const inGroup = new Set(g.cells.map(key));
  const pref = preferred.find((p) => inGroup.has(key(p)));
  if (pref) return pref;
  if (g.isCross) {
    const rowCount = new Map<number, number>();
    const colCount = new Map<number, number>();
    for (const p of g.cells) {
      rowCount.set(p.row, (rowCount.get(p.row) ?? 0) + 1);
      colCount.set(p.col, (colCount.get(p.col) ?? 0) + 1);
    }
    const corner = g.cells.find((p) => rowCount.get(p.row)! >= 3 && colCount.get(p.col)! >= 3);
    if (corner) return corner;
  }
  const sorted = [...g.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export function rowCells(board: Board, row: number): Pos[] {
  if (row < 0 || row >= board.height) return [];
  return Array.from({ length: board.width }, (_, col) => ({ row, col }));
}

export function colCells(board: Board, col: number): Pos[] {
  if (col < 0 || col >= board.width) return [];
  return Array.from({ length: board.height }, (_, row) => ({ row, col }));
}

export function squareCells(board: Board, center: Pos, radius: number): Pos[] {
  const cells: Pos[] = [];
  for (let row = center.row - radius; row <= center.row + radius; row++)
    for (let col = center.col - radius; col <= center.col + radius; col++)
      if (board.inBounds({ row, col })) cells.push({ row, col });
  return cells;
}

export function allCells(board: Board): Pos[] {
  return Array.from({ length: board.height }, (_, row) => rowCells(board, row)).flat();
}

/** Зона поражения луча или бомбы. Радуга от взрыва обрабатывается отдельно (нужен выбор цвета). */
export function blastArea(board: Board, at: Pos, special: 'lineH' | 'lineV' | 'bomb'): Pos[] {
  if (special === 'lineH') return rowCells(board, at.row);
  if (special === 'lineV') return colCells(board, at.col);
  return squareCells(board, at, 1);
}

/** Комбо для пары фишек; null — обычный свап, нужен матч. */
export function comboKind(a: Piece, b: Piece): ComboKind | null {
  const isLine = (s: Special) => s === 'lineH' || s === 'lineV';
  const [x, y] = [a.special, b.special];
  if (x === 'lantern' || y === 'lantern') return null;
  if (x === 'rainbow' && y === 'rainbow') return 'sakuraStorm';
  if (x === 'rainbow' || y === 'rainbow') {
    const other = x === 'rainbow' ? y : x;
    if (other === 'none') return 'colorBlast';
    return other === 'bomb' ? 'rainbowBomb' : 'rainbowLine';
  }
  if (isLine(x) && isLine(y)) return 'doubleLine';
  if ((isLine(x) && y === 'bomb') || (x === 'bomb' && isLine(y))) return 'crossFlash';
  if (x === 'bomb' && y === 'bomb') return 'megaBomb';
  return null;
}
