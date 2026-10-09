/** Цвет фишки: 0 звезда, 1 сердце, 2 луна, 3 лепесток, 4 капля, 5 лист. */
export type Color = 0 | 1 | 2 | 3 | 4 | 5;

export const MIN_COLORS = 4;
export const MAX_COLORS = 6;
export const MAX_SIZE = 9;

export interface Piece {
  /** Уникален в пределах партии — клиент по нему ведёт спрайт. */
  readonly id: number;
  readonly color: Color;
}

export interface Pos {
  readonly row: number;
  readonly col: number;
}

/** grid[row][col], row 0 — верх поля. */
export type Grid = (Piece | null)[][];

export interface MatchGroup {
  readonly color: Color;
  readonly cells: Pos[];
  /** Самая длинная линия в группе (3, 4, 5+). */
  readonly longestLine: number;
  /** Группа из пересекающихся горизонтали и вертикали (L/T). */
  readonly isCross: boolean;
}

export interface Swap {
  readonly a: Pos;
  readonly b: Pos;
}

export interface Fall {
  readonly id: number;
  readonly from: Pos;
  readonly to: Pos;
}

export interface Spawn {
  readonly piece: Piece;
  readonly at: Pos;
}

/** Шаг каскада: матч → удаление → гравитация → досыпка. */
export interface CascadeStep {
  readonly groups: MatchGroup[];
  readonly cleared: Pos[];
  readonly falls: Fall[];
  readonly spawns: Spawn[];
  readonly scoreGained: number;
}

export type GameEvent =
  | { readonly type: 'swap'; readonly swap: Swap }
  | { readonly type: 'swapBack'; readonly swap: Swap }
  | { readonly type: 'cascade'; readonly step: CascadeStep; readonly index: number }
  | { readonly type: 'shuffle'; readonly moves: Fall[] }
  /** Перемешать не удалось — поле собрано заново новыми фишками. */
  | { readonly type: 'reset'; readonly pieces: Spawn[] };

export interface SwapResult {
  readonly valid: boolean;
  readonly events: GameEvent[];
}
