import { Board } from './board.ts';
import { findMatches } from './match.ts';
import { findValidSwaps, isAdjacent, isValidSwap, swapPieces } from './moves.ts';
import { Rng } from './rng.ts';
import {
  allCells, anchorFor, blastArea, colCells, comboKind, rowCells, specialForGroup, squareCells,
} from './specials.ts';
import type { MadeSpecial } from './specials.ts';
import { starsFor } from './goals.ts';
import type { Goal, GoalProgress, LanternRule } from './goals.ts';
import type {
  Activation, Color, ComboKind, CascadeStep, Fall, GameEvent, MatchGroup, Pos, Spawn, Swap, SwapResult,
} from './types.ts';

export const POINTS_PER_PIECE = 20;
/** Бонус за рождение спецфишки, не умножается на каскад. */
export const SPECIAL_BONUS: Readonly<Record<MadeSpecial, number>> = { lineH: 60, lineV: 60, bomb: 100, rainbow: 200 };
/** «Финальный салют»: очки за каждый неиспользованный ход при победе. */
export const FINALE_BONUS_PER_MOVE = 100;

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
  /** Форма поля: # — клетка, _ — дыра. Без неё поле прямоугольное. */
  readonly shape?: readonly string[];
  /** Заданная расстановка (формат Board.fromStrings). Без готовых матчей; дыры — как в shape. */
  readonly layout?: readonly string[];
  /** Слои желе по клеткам: цифры 0–2, в дырах — _. */
  readonly jelly?: readonly string[];
  /** Пустой список — песочница: победы нет, партия идёт до конца ходов. */
  readonly goals?: readonly Goal[];
  readonly lanterns?: LanternRule;
  /** Пороги очков для 1, 2, 3 звёзд. */
  readonly stars?: readonly [number, number, number];
}

export type GameStatus = 'playing' | 'won' | 'lost';

function holesFromShape(shape: readonly string[] | undefined, width: number, height: number): Pos[] {
  if (!shape) return [];
  if (shape.length !== height || shape.some((r) => r.length !== width)) throw new Error(`shape must be ${width}x${height}`);
  const holes: Pos[] = [];
  shape.forEach((line, row) => [...line].forEach((ch, col) => {
    if (ch === '_') holes.push({ row, col });
    else if (ch !== '#') throw new Error(`shape: bad char '${ch}' at ${row},${col}`);
  }));
  return holes;
}

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
  private _won = false;
  private readonly _history: Swap[] = [];
  private readonly jelly: number[][];
  private readonly jellyTotal: number;
  private jellyLeft: number;
  private readonly collectedByColor = new Map<Color, number>();
  private lanternsSpawned = 0;
  private lanternsCollected = 0;

  constructor(options: GameOptions) {
    if (!Number.isInteger(options.moves) || options.moves < 1) throw new RangeError(`moves ${options.moves}`);
    this.options = options;
    this.rng = new Rng(options.seed);
    this._movesLeft = options.moves;
    const holes = holesFromShape(options.shape, options.width, options.height);

    if (options.layout) {
      this.board = Board.fromStrings(options.layout, options.colors);
      if (this.board.width !== options.width || this.board.height !== options.height) {
        throw new Error(`layout is ${this.board.width}x${this.board.height}, expected ${options.width}x${options.height}`);
      }
      if (options.shape && holes.some((h) => !this.board.isHole(h))) throw new Error('layout holes differ from shape');
      if (this.board.playableCells().some((p) => !this.board.get(p))) throw new Error('layout has empty cells');
      if (findMatches(this.board).length > 0) throw new Error('layout has ready matches');
      this.lanternsSpawned = this.board.playableCells().filter((p) => this.board.get(p)!.special === 'lantern').length;
    } else {
      this.board = new Board(options.width, options.height, options.colors, holes);
      this.board.fillWithoutMatches(this.rng);
      this.placeStartLanterns();
    }

    this.jelly = Array.from({ length: options.height }, () => Array<number>(options.width).fill(0));
    if (options.jelly) {
      if (options.jelly.length !== options.height || options.jelly.some((r) => r.length !== options.width)) {
        throw new Error(`jelly must be ${options.width}x${options.height}`);
      }
      options.jelly.forEach((line, row) => [...line].forEach((ch, col) => {
        if (ch === '_' || ch === '0') return;
        if (ch !== '1' && ch !== '2') throw new Error(`jelly: bad char '${ch}' at ${row},${col}`);
        if (this.board.isHole({ row, col })) throw new Error(`jelly on a hole at ${row},${col}`);
        this.jelly[row]![col] = Number(ch);
      }));
    }
    this.jellyTotal = this.jelly.flat().reduce((a, b) => a + b, 0);
    this.jellyLeft = this.jellyTotal;
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
    if (this._won) return 'won';
    return this._movesLeft > 0 ? 'playing' : 'lost';
  }

  get stars(): 0 | 1 | 2 | 3 {
    return this.options.stars ? starsFor(this._score, this.options.stars, this._won) : 0;
  }

  jellyAt(p: Pos): number {
    return this.jelly[p.row]?.[p.col] ?? 0;
  }

  goalProgress(): GoalProgress[] {
    return (this.options.goals ?? []).map((goal) => {
      switch (goal.type) {
        case 'score':
          return { goal, current: this._score, target: goal.target, done: this._score >= goal.target };
        case 'jelly':
          return { goal, current: this.jellyTotal - this.jellyLeft, target: this.jellyTotal, done: this.jellyLeft === 0 };
        case 'lanterns':
          return { goal, current: this.lanternsCollected, target: goal.count, done: this.lanternsCollected >= goal.count };
        case 'collect': {
          const n = this.collectedByColor.get(goal.color) ?? 0;
          return { goal, current: Math.min(n, goal.count), target: goal.count, done: n >= goal.count };
        }
      }
    });
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
      const adjacent = this.board.isPlayable(swap.a) && this.board.isPlayable(swap.b) && isAdjacent(swap.a, swap.b);
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

    const goals = this.goalProgress();
    if (goals.length > 0 && goals.every((g) => g.done)) {
      this._won = true;
      const bonus = this._movesLeft * FINALE_BONUS_PER_MOVE;
      this._score += bonus;
      events.push({ type: 'finale', movesLeft: this._movesLeft, bonus });
    } else {
      events.push(...this.ensurePlayable());
    }
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
      // фонарики неуязвимы: их можно только довести до низа
      if (!piece || piece.special === 'lantern') continue;
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

    const jellyHit: Pos[] = [];
    for (const p of cleared.values()) {
      const color = this.board.get(p)?.color;
      if (color !== undefined && color !== null) this.collectedByColor.set(color, (this.collectedByColor.get(color) ?? 0) + 1);
      this.board.set(p, null);
      const row = this.jelly[p.row]!;
      if (row[p.col]! > 0) {
        row[p.col]!--;
        this.jellyLeft--;
        jellyHit.push(p);
      }
    }
    const created: Spawn[] = toCreate.map(({ at, special, color }) => {
      const piece = special === 'rainbow' ? this.board.makeRainbow() : this.board.makePiece(color, special);
      this.board.set(at, piece);
      return { piece, at };
    });

    const bonus = created.reduce((sum, c) => sum + SPECIAL_BONUS[c.piece.special as MadeSpecial], 0);
    const scoreGained = cleared.size * POINTS_PER_PIECE * (index + 1) + bonus;
    this._score += scoreGained;

    const falls = this.applyGravity();
    const lanternsCollected: { id: number; at: Pos }[] = [];
    for (;;) {
      const exits = this.lanternsAtExits();
      if (exits.length === 0) break;
      for (const { id, at } of exits) {
        this.board.set(at, null);
        lanternsCollected.push({ id, at });
        this.lanternsCollected++;
      }
      falls.push(...this.applyGravity());
    }
    const spawns = this.refill();
    return {
      combo: plan.combo, groups: plan.groups, activations, cleared: [...cleared.values()],
      created, jellyHit, lanternsCollected, falls, spawns, scoreGained,
    };
  }

  /** Фонарики на нижней клетке своего столбца. */
  private lanternsAtExits(): { id: number; at: Pos }[] {
    const exits: { id: number; at: Pos }[] = [];
    for (let col = 0; col < this.board.width; col++) {
      const at = this.board.columnCells(col).at(-1);
      const piece = at && this.board.get(at);
      if (at && piece?.special === 'lantern') exits.push({ id: piece.id, at });
    }
    return exits;
  }

  private canSpawnLantern(): boolean {
    const rule = this.options.lanterns;
    if (!rule) return false;
    const onBoard = this.lanternsSpawned - this.lanternsCollected;
    return this.lanternsSpawned < rule.total && onBoard < rule.maxOnBoard;
  }

  /** Стартовые фонарики — в верхние клетки случайных столбцов. */
  private placeStartLanterns(): void {
    const rule = this.options.lanterns;
    if (!rule) return;
    const tops = this.rng.shuffle(Array.from({ length: this.board.width }, (_, col) => this.board.columnCells(col)[0])
      .filter((p): p is Pos => p !== undefined));
    for (const at of tops) {
      if (!this.canSpawnLantern()) break;
      this.board.set(at, this.board.makeLantern());
      this.lanternsSpawned++;
    }
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

  /** Фишки падают вниз по клеткам столбца, пролетая сквозь дыры. */
  private applyGravity(): Fall[] {
    const falls: Fall[] = [];
    for (let col = 0; col < this.board.width; col++) {
      const cells = this.board.columnCells(col);
      let target = cells.length - 1;
      for (let i = cells.length - 1; i >= 0; i--) {
        const from = cells[i]!;
        const piece = this.board.get(from);
        if (!piece) continue;
        const to = cells[target]!;
        if (i !== target) {
          this.board.set(to, piece);
          this.board.set(from, null);
          falls.push({ id: piece.id, from, to });
        }
        target--;
      }
    }
    return falls;
  }

  private refill(): Spawn[] {
    const empty = this.board.playableCells().filter((p) => !this.board.get(p));
    const rule = this.options.lanterns;
    const lanternAt = rule && empty.length > 0 && this.canSpawnLantern() && this.rng.next() < rule.spawnChance
      ? this.rng.int(empty.length)
      : -1;
    // порядок досыпки: по столбцам снизу вверх — как в этапе 1
    const ordered = [...empty.keys()].sort((i, j) => empty[i]!.col - empty[j]!.col || empty[j]!.row - empty[i]!.row);
    return ordered.map((i) => {
      const at = empty[i]!;
      let piece;
      if (i === lanternAt) {
        piece = this.board.makeLantern();
        this.lanternsSpawned++;
      } else {
        piece = this.board.makePiece(this.board.randomColor(this.rng));
      }
      this.board.set(at, piece);
      return { piece, at };
    });
  }

  /** Если ходов нет — перемешать; если и это не помогло — собрать поле заново. */
  private ensurePlayable(): GameEvent[] {
    if (findValidSwaps(this.board).length > 0) return [];

    const cells = this.board.playableCells();
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

    // фонарики переживают пересборку на своих местах — иначе цель станет невыполнимой
    const lanterns = cells.flatMap((at) => (this.board.get(at)?.special === 'lantern' ? [{ at, piece: this.board.get(at)! }] : []));
    for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt++) {
      this.board.fillWithoutMatches(this.rng);
      for (const { at, piece } of lanterns) this.board.set(at, piece);
      if (findMatches(this.board).length === 0 && findValidSwaps(this.board).length > 0) {
        return [{ type: 'reset', pieces: cells.map((at) => ({ piece: this.board.get(at)!, at })) }];
      }
    }
    throw new Error('board has no valid moves after reset');
  }
}
