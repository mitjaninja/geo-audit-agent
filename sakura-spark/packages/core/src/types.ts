/** Цвет фишки: 0 звезда, 1 сердце, 2 луна, 3 лепесток, 4 капля, 5 лист. */
export type Color = 0 | 1 | 2 | 3 | 4 | 5;

export const MIN_COLORS = 4;
export const MAX_COLORS = 6;
export const MAX_SIZE = 9;

/**
 * Спецфишки:
 * - lineH / lineV — «Луч фонаря», очищает ряд / столбец.
 *   Горизонтальная четвёрка даёт lineV, вертикальная — lineH (луч бьёт поперёк матча).
 * - bomb — «Бумажная бомба», взрыв 3×3 (L/T-фигура).
 * - rainbow — «Радужный кристалл» (5 в линию), цвета не имеет.
 */
export type Special = 'none' | 'lineH' | 'lineV' | 'bomb' | 'rainbow';

export interface Piece {
  /** Уникален в пределах партии — клиент по нему ведёт спрайт. */
  readonly id: number;
  /** null только у радужного кристалла. */
  readonly color: Color | null;
  readonly special: Special;
}

/**
 * Комбо при свапе двух спецфишек (или радуги с любой фишкой):
 * - colorBlast — радуга + обычная: убрать все фишки этого цвета;
 * - rainbowLine / rainbowBomb — радуга + луч/бомба: фишки цвета становятся лучами/бомбами и срабатывают;
 * - sakuraStorm — радуга + радуга: всё поле;
 * - doubleLine — луч + луч: ряд и столбец;
 * - crossFlash — луч + бомба: «Крест-вспышка», три ряда и три столбца;
 * - megaBomb — бомба + бомба: взрыв 5×5.
 */
export type ComboKind = 'colorBlast' | 'rainbowLine' | 'rainbowBomb' | 'sakuraStorm' | 'doubleLine' | 'crossFlash' | 'megaBomb';

/** Сработавшая спецфишка — клиенту для эффекта. */
export interface Activation {
  readonly at: Pos;
  readonly special: Exclude<Special, 'none'>;
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

/** Шаг каскада: матч/комбо → срабатывание спецфишек → удаление → новые спецфишки → гравитация → досыпка. */
export interface CascadeStep {
  /** Комбо свапа — только в первом шаге хода. */
  readonly combo: ComboKind | null;
  readonly groups: MatchGroup[];
  readonly activations: Activation[];
  readonly cleared: Pos[];
  /** Спецфишки, родившиеся из матчей; ставятся на очищенные клетки до гравитации. */
  readonly created: Spawn[];
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
