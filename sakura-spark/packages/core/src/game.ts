import { Board } from './board.ts';
import { findMatches } from './match.ts';
import { findValidSwaps, isAdjacent, isValidSwap, swapPieces } from './moves.ts';
import { Rng } from './rng.ts';
import {
  allCells, anchorFor, blastArea, colCells, comboKind, rowCells, specialForGroup, squareCells,
} from './specials.ts';
import type { MadeSpecial } from './specials.ts';
import type {
  Activation, Color, ComboKind, CascadeStep, Fall, GameEvent, MatchGroup, Pos, Spawn, Swap, SwapResult,
} from './types.ts';

export const POINTS_PER_PIECE = 20;
/** Бонус за рождение спецфишки, не умножается на каскад. */
export const SPECIAL_BONUS: Readonly<Record<MadeSpecial, number>> = { lineH: 60, lineV: 60, bomb: 100, rainbow: 200 };

/** Что снимает шаг: матчи + стартовые цели (комбо) + клетки, «съеденные» комбо без срабатывания. */
interface StepPlan {
  readonly combo: ComboKind | null;
  readonly groups: MatchGroup[];
  readonly targets: Pos[];
  readonly consumed: Pos[];
  /** Клетки хода: здесь предпочтительно рождаются спецфишки. */
  readonly preferred: Pos[];
}

const key = (p: Pos) => `${p.row},${p.col}`;
/** Предохранитель от бесконечного каскада при ошибке в правилах. */
const MAX_CASCADES = 100;
const SHUFFLE_ATTEMPTS = 50;

export interface GameOptions {
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly moves: number;
  readonly seed: number;
  /** Заданная расстановка (формат Board.fromStrings). Без готовых матчей. */
  readonly layout?: readonly string[];
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
    this._movesLeft = options.moves;
    if (options.layout) {
      this.board = Board.fromStrings([...options.layout], options.colors);
      if (this.board.width !== options.width || this.board.height !== options.height) {
        throw new Error(`layout is ${this.board.width}x${this.board.height}, expected ${options.width}x${options.height}`);
      }
      if (this.board.toStrings().some((r) => r.includes('.'))) throw new Error('layout has empty cells');
      if (findMatches(this.board).length > 0) throw new Error('layout has ready matches');
    } else {
      this.board = new Board(options.width, options.height, options.colors);
      this.board.fillWithoutMatches(this.rng);
    }
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
    if (!isValidSwap(this.board, swap)) {
      const adjacent = this.board.inBounds(swap.a) && this.board.inBounds(swap.b) && isAdjacent(swap.a, swap.b);
      return { valid: false, events: adjacent ? [{ type: 'swap', swap }, { type: 'swapBack', swap }] : [] };
    }

    const events: GameEvent[] = [{ type: 'swap', swap }];
    swapPieces(this.board, swap);
    this._movesLeft--;
    this._history.push(swap);

    const combo = this.comboPlan(swap);
    for (let index = 0; index < MAX_CASCADES; index++) {
      const plan: StepPlan | null = index === 0 && combo
        ? combo
        : this.matchPlan(index === 0 ? [swap.b, swap.a] : []);
      if (!plan) break;
      events.push({ type: 'cascade', step: this.resolveStep(index, plan), index });
    }
    events.push(...this.ensurePlayable());
    return { valid: true, events };
  }

  private matchPlan(preferred: Pos[]): StepPlan | null {
    const groups = findMatches(this.board);
    if (groups.length === 0) return null;
    return { combo: null, groups, targets: [], consumed: [], preferred };
  }

  /** План комбо после свапа; фишка, которую тянули, теперь в b. */
  private comboPlan({ a, b }: Swap): StepPlan | null {
    const pa = this.board.get(a)!;
    const pb = this.board.get(b)!;
    const kind = comboKind(pa, pb);
    if (!kind) return null;
    const plan = (targets: Pos[], consumed: Pos[]): StepPlan => ({ combo: kind, groups: [], targets, consumed, preferred: [] });

    switch (kind) {
      case 'sakuraStorm':
        return plan(allCells(this.board), [a, b]);
      case 'doubleLine':
        return plan([...rowCells(this.board, b.row), ...colCells(this.board, b.col)], [a, b]);
      case 'crossFlash': {
        const targets: Pos[] = [];
        for (let d = -1; d <= 1; d++) targets.push(...rowCells(this.board, b.row + d), ...colCells(this.board, b.col + d));
        return plan(targets, [a, b]);
      }
      case 'megaBomb':
        return plan(squareCells(this.board, b, 2), [a, b]);
      default: {
        const [rainbowAt, other] = pa.special === 'rainbow' ? [a, pb] : [b, pa];
        const color = other.color!;
        const cells = this.cellsOfColor(color, new Set());
        if (kind === 'rainbowLine' || kind === 'rainbowBomb') {
          for (const p of cells) {
            const piece = this.board.get(p)!;
            if (piece.special !== 'none') continue;
            const special = kind === 'rainbowBomb' ? 'bomb' : this.rng.int(2) === 0 ? 'lineH' : 'lineV';
            this.board.set(p, Board.withSpecial(piece, special));
          }
        }
        return plan(cells, [rainbowAt]);
      }
    }
  }

  /**
   * Один шаг каскада: снять клетки плана, по цепочке сработать спецфишкам,
   * поставить новые спецфишки, уронить и досыпать.
   */
  private resolveStep(index: number, plan: StepPlan): CascadeStep {
    const cleared = new Map<string, Pos>();
    for (const p of plan.consumed) cleared.set(key(p), p);

    const toCreate: { at: Pos; special: MadeSpecial; color: Color }[] = [];
    for (const g of plan.groups) {
      const special = specialForGroup(g);
      if (!special) continue;
      const at = anchorFor(g, plan.preferred);
      if (!toCreate.some((c) => key(c.at) === key(at))) toCreate.push({ at, special, color: g.color });
    }

    const activations: Activation[] = [];
    const queue: Pos[] = [...plan.groups.flatMap((g) => g.cells), ...plan.targets];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      if (cleared.has(key(p))) continue;
      const piece = this.board.get(p);
      if (!piece) continue;
      cleared.set(key(p), p);
      if (piece.special === 'none') continue;
      activations.push({ at: p, special: piece.special });
      if (piece.special === 'rainbow') {
        const color = this.mostCommonColor(cleared);
        if (color !== null) queue.push(...this.cellsOfColor(color, cleared));
      } else {
        queue.push(...blastArea(this.board, p, piece.special));
      }
    }

    for (const p of cleared.values()) this.board.set(p, null);
    const created: Spawn[] = toCreate.map(({ at, special, color }) => {
      const piece = special === 'rainbow' ? this.board.makeRainbow() : this.board.makePiece(color, special);
      this.board.set(at, piece);
      return { piece, at };
    });

    const bonus = created.reduce((sum, c) => sum + SPECIAL_BONUS[c.piece.special as MadeSpecial], 0);
    const scoreGained = cleared.size * POINTS_PER_PIECE * (index + 1) + bonus;
    this._score += scoreGained;

    const falls = this.applyGravity();
    const spawns = this.refill();
    return {
      combo: plan.combo, groups: plan.groups, activations, cleared: [...cleared.values()],
      created, falls, spawns, scoreGained,
    };
  }

  private cellsOfColor(color: Color, exclude: Map<string, Pos> | Set<string>): Pos[] {
    return allCells(this.board).filter((p) => !exclude.has(key(p)) && this.board.get(p)?.color === color);
  }

  /** Цвет для радуги, задетой взрывом: самый частый среди оставшихся, при равенстве — меньший. */
  private mostCommonColor(exclude: Map<string, Pos>): Color | null {
    const counts = new Map<Color, number>();
    for (const p of allCells(this.board)) {
      const c = this.board.get(p)?.color;
      if (c === undefined || c === null || exclude.has(key(p))) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: Color | null = null;
    for (const [c, n] of counts) {
      if (best === null || n > counts.get(best)! || (n === counts.get(best)! && c < best)) best = c;
    }
    return best;
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
