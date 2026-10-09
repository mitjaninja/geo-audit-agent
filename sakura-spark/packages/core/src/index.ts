export * from './types.ts';
export { Rng } from './rng.ts';
export { Board } from './board.ts';
export { findMatches, hasMatchAt } from './match.ts';
export { findValidSwaps, isAdjacent, swapMakesMatch, swapPieces } from './moves.ts';
export { Match3Game, POINTS_PER_PIECE } from './game.ts';
export type { GameOptions, GameStatus } from './game.ts';
