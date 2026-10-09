import { Board } from './board.ts';
import { findMatches } from './match.ts';
import { findValidSwaps, isAdjacent, swapMakesMatch, swapPieces } from './moves.ts';
import { Rng } from './rng.ts';
import type { CascadeStep, Fall, GameEvent, Pos, Spawn, Swap, SwapResult } from './types.ts';

export const POINTS_PER_PIECE = 20;
/** Предохранитель от бесконечного каскада при ошибке в правилах. */
const MAX_CASCADES = 100;
const SHUFFLE_ATTEMPTS = 50;

export interface GameOptions {
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly moves: number;
  readonly seed: number;
}

export type GameStatus = 'playing' | 'out_of_moves';

/**
 * Партия match-3. Вся случайность — из сида, поэтому партию можно
 * воспроизвести на сервере по списку свапов (см. replay).
 */
export class Match3Game {
  readonly options: GameOptions;
  readonly board: Board;
  private readonly rng: Rng;
  private _movesLeft: number;
  private _score = 0;
  private readonly _history: Swap[] = [];

  constructor(options: GameOptions) {
    if (!Number.isInteger(options.moves) || options.moves < 1) throw new RangeError(`moves ${options.moves}`);
    this.options = options;
    this.rng = new Rng(options.seed);
    this.board = new Board(options.width, options.height, options.colors);
    this._movesLeft = options.moves;
    this.board.fillWithoutMatches(this.rng);
    this.ensurePlayable();
  }

  static replay(options: GameOptions, swaps: readonly Swap[]): Match3Game {
    const game = new Match3Game(options);
    for (const [i, swap] of swaps.entries()) {
      if (!game.swap(swap).valid) throw new Error(`replay: swap #${i} is invalid`);
    }
    return game;
  }

  get movesLeft(): number {
    return this._movesLeft;
  }

  get score(): number {
    return this._score;
  }

  get history(): readonly Swap[] {
    return this._history;
  }

  get status(): GameStatus {
    return this._movesLeft > 0 ? 'playing' : 'out_of_moves';
  }

  validSwaps(): Swap[] {
    return findValidSwaps(this.board);
  }

  /**
   * Ход игрока. Невалидный свап (не соседи, нет матча) не тратит ход:
   * клиент получает swap + swapBack для анимации отскока.
   */
  swap(swap: Swap): SwapResult {
    if (this.status !== 'playing') return { valid: false, events: [] };
    if (!swapMakesMatch(this.board, swap)) {
      const adjacent = this.board.inBounds(swap.a) && this.board.inBounds(swap.b) && isAdjacent(swap.a, swap.b);
      return { valid: false, events: adjacent ? [{ type: 'swap', swap }, { type: 'swapBack', swap }] : [] };
    }

    const events: GameEvent[] = [{ type: 'swap', swap }];
    swapPieces(this.board, swap);
    this._movesLeft--;
    this._history.push(swap);

    for (let index = 0; index < MAX_CASCADES; index++) {
      const step = this.resolveOnce(index);
      if (!step) break;
      events.push({ type: 'cascade', step, index });
    }
    events.push(...this.ensurePlayable());
    return { valid: true, events };
  }

  /** Один шаг каскада: снять матчи, уронить фишки, досыпать сверху. */
  private resolveOnce(index: number): CascadeStep | null {
    const groups = findMatches(this.board);
    if (groups.length === 0) return null;

    const cleared = new Map<string, Pos>();
    for (const g of groups) for (const p of g.cells) cleared.set(`${p.row},${p.col}`, p);
    for (const p of cleared.values()) this.board.set(p, null);

    const scoreGained = cleared.size * POINTS_PER_PIECE * (index + 1);
    this._score += scoreGained;

    const falls = this.applyGravity();
    const spawns = this.refill();
    return { groups, cleared: [...cleared.values()], falls, spawns, scoreGained };
  }

  private applyGravity(): Fall[] {
    const falls: Fall[] = [];
    for (let col = 0; col < this.board.width; col++) {
      let target = this.board.height - 1;
      for (let row = this.board.height - 1; row >= 0; row--) {
        const piece = this.board.get({ row, col });
        if (!piece) continue;
        if (row !== target) {
          this.board.set({ row: target, col }, piece);
          this.board.set({ row, col }, null);
          falls.push({ id: piece.id, from: { row, col }, to: { row: target, col } });
        }
        target--;
      }
    }
    return falls;
  }

  private refill(): Spawn[] {
    const spawns: Spawn[] = [];
    for (let col = 0; col < this.board.width; col++) {
      for (let row = this.board.height - 1; row >= 0; row--) {
        const at = { row, col };
        if (this.board.get(at)) continue;
        const piece = this.board.makePiece(this.board.randomColor(this.rng));
        this.board.set(at, piece);
        spawns.push({ piece, at });
      }
    }
    return spawns;
  }

  /** Если ходов нет — перемешать; если и это не помогло — собрать поле заново. */
  private ensurePlayable(): GameEvent[] {
    if (findValidSwaps(this.board).length > 0) return [];

    const cells: Pos[] = [];
    for (let row = 0; row < this.board.height; row++)
      for (let col = 0; col < this.board.width; col++) cells.push({ row, col });
    const original = cells.map((p) => this.board.get(p)!);

    for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt++) {
      const order = this.rng.shuffle(cells.map((_, i) => i));
      order.forEach((src, dst) => this.board.set(cells[dst]!, original[src]!));
      if (findMatches(this.board).length === 0 && findValidSwaps(this.board).length > 0) {
        const moves: Fall[] = [];
        order.forEach((src, dst) => {
          if (src !== dst) moves.push({ id: original[src]!.id, from: cells[src]!, to: cells[dst]! });
        });
        return [{ type: 'shuffle', moves }];
      }
    }

    for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt++) {
      this.board.fillWithoutMatches(this.rng);
      if (findValidSwaps(this.board).length > 0) {
        return [{ type: 'reset', pieces: cells.map((at) => ({ piece: this.board.get(at)!, at })) }];
      }
    }
    throw new Error('board has no valid moves after reset');
  }
}
