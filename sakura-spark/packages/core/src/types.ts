import type { BlockerKind } from './blockers.ts';

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
 * - lantern — фонарик-ингредиент: не матчится и не взрывается, собирается внизу поля.
 */
export type Special = 'none' | 'lineH' | 'lineV' | 'bomb' | 'rainbow' | 'lantern';

export interface Piece {
  /** Уникален в пределах партии — клиент по нему ведёт спрайт. */
  readonly id: number;
  /** null у радужного кристалла и фонарика. */
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
  readonly special: 'lineH' | 'lineV' | 'bomb' | 'rainbow';
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

/** Бустеры во время игры (PRD, «Монетизация»): ход не тратят. */
export type BoosterId = 'hammer' | 'freeSwap' | 'shuffle';

/**
 * Действие игрока в истории партии. Реплей на сервере проигрывает их по порядку,
 * поэтому каждый использованный бустер и каждая докупка ходов проверяемы.
 */
export type Move =
  | Swap
  /** Молот Пона: убрать одну фишку (спецфишка сработает) или ударить по блокеру. */
  | { readonly booster: 'hammer'; readonly at: Pos }
  /** Свободный обмен: поменять соседние фишки без матча. */
  | { readonly booster: 'freeSwap'; readonly a: Pos; readonly b: Pos }
  /** Перемешать поле. */
  | { readonly booster: 'shuffle' }
  /** Докупка ходов после того, как они кончились (окно «+5 ходов»). */
  | { readonly extraMoves: number };

export const isPlainSwap = (m: Move): m is Swap => !('booster' in m) && !('extraMoves' in m);

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
  /** Блокеры, получившие удар; layersLeft 0 — блокер снят. */
  readonly blockersHit: { readonly at: Pos; readonly kind: BlockerKind; readonly layersLeft: number }[];
  /** Клетки, где снят слой желе. */
  readonly jellyHit: Pos[];
  /** Фонарики, дошедшие до низа и собранные (уже после первой гравитации). */
  readonly lanternsCollected: { readonly id: number; readonly at: Pos }[];
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
  | { readonly type: 'reset'; readonly pieces: Spawn[] }
  /** За ход не снят ни один туман — он поглотил соседнюю фишку. */
  | { readonly type: 'fogSpread'; readonly from: Pos; readonly to: Pos; readonly pieceId: number }
  | { readonly type: 'booster'; readonly booster: BoosterId; readonly at?: Pos }
  | { readonly type: 'extraMoves'; readonly moves: number }
  /** Победа: оставшиеся ходы превращаются в очки. */
  | { readonly type: 'finale'; readonly movesLeft: number; readonly bonus: number };

export interface SwapResult {
  readonly valid: boolean;
  readonly events: GameEvent[];
}
