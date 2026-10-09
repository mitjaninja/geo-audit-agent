import { Rng } from '@sakura/core';
import type { Match3Game, Swap } from '@sakura/core';

/** Бот выбирает ход для текущей партии. Партия гарантированно в статусе playing. */
export type Bot = (game: Match3Game) => Swap;
export type BotName = 'random' | 'greedy';

export function randomBot(seed: number): Bot {
  const rng = new Rng(seed);
  return (game) => {
    const swaps = game.validSwaps();
    return swaps[rng.int(swaps.length)]!;
  };
}

/**
 * Оценка позиции для жадного бота: прогресс целей важнее всего, затем спецфишки на поле
 * и фонарики поближе к низу; очки — только для разрешения ничьих.
 */
export function evaluate(game: Match3Game): number {
  if (game.status === 'won') return 1000 + game.movesLeft;
  let value = 0;
  for (const g of game.goalProgress()) value += g.target > 0 ? Math.min(1, g.current / g.target) : 1;
  value *= 10;
  const { board } = game;
  for (const p of board.playableCells()) {
    const piece = board.get(p);
    if (!piece) continue;
    if (piece.special === 'rainbow') value += 0.6;
    else if (piece.special === 'lantern') value += 0.5 * (p.row / board.height);
    else if (piece.special !== 'none') value += 0.3;
  }
  return value + game.score / 100_000;
}

/**
 * Жадный бот на один ход вперёд: примеряет каждый допустимый свап на копии партии
 * с чужим сидом (не подсматривает реальную досыпку) и берёт лучшую оценку.
 */
export function greedyBot(seed: number): Bot {
  const rng = new Rng(seed);
  return (game) => {
    const swaps = game.validSwaps();
    const peekSeed = rng.int(2 ** 31);
    let best: Swap[] = [];
    let bestValue = -Infinity;
    for (const swap of swaps) {
      const copy = game.clone(peekSeed);
      copy.swap(swap);
      const v = evaluate(copy);
      if (v > bestValue + 1e-9) {
        bestValue = v;
        best = [swap];
      } else if (Math.abs(v - bestValue) <= 1e-9) {
        best.push(swap);
      }
    }
    return best[rng.int(best.length)]!;
  };
}

export function makeBot(name: BotName, seed: number): Bot {
  return name === 'greedy' ? greedyBot(seed) : randomBot(seed);
}
