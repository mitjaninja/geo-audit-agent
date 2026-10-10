import type { Color } from './types.ts';

/**
 * Цели уровня (PRD, «Типы уровней»): очки, желе, фонарики, сбор цвета, туман.
 * Таймер — вместе с клиентом (этап 5).
 */
export type Goal =
  | { readonly type: 'score'; readonly target: number }
  | { readonly type: 'jelly' }
  | { readonly type: 'lanterns'; readonly count: number }
  | { readonly type: 'collect'; readonly color: Color; readonly count: number }
  | { readonly type: 'fog' };

export interface GoalProgress {
  readonly goal: Goal;
  readonly current: number;
  readonly target: number;
  readonly done: boolean;
}

/** Как появляются фонарики на уровне с целью lanterns. */
export interface LanternRule {
  /** Сколько фонариков всего придёт за уровень. */
  readonly total: number;
  /** Не больше стольких одновременно на поле. */
  readonly maxOnBoard: number;
  /** Шанс, что досыпка в шаге каскада принесёт фонарик (0..1). */
  readonly spawnChance: number;
}

/** Звёзды по порогам очков; победа — минимум одна звезда. */
export function starsFor(score: number, thresholds: readonly [number, number, number], won: boolean): 0 | 1 | 2 | 3 {
  if (!won) return 0;
  const reached = thresholds.filter((t) => score >= t).length;
  return Math.max(1, reached) as 1 | 2 | 3;
}
