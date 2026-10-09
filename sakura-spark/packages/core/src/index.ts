export * from './types.ts';
export { Rng } from './rng.ts';
export { Board } from './board.ts';
export { findMatches, hasMatchAt } from './match.ts';
export { findValidSwaps, isAdjacent, isValidSwap, swapIsCombo, swapMakesMatch, swapPieces } from './moves.ts';
export { anchorFor, blastArea, comboKind, specialForGroup } from './specials.ts';
export { Match3Game, POINTS_PER_PIECE, SPECIAL_BONUS } from './game.ts';
export type { GameOptions, GameStatus } from './game.ts';
