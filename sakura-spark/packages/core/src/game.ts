import { Board } from './board.ts';
import { BLOCKER_CHARS, damage, layersOf } from './blockers.ts';
import type { BlockerKind, Portal } from './blockers.ts';
import { findMatches } from './match.ts';
import { canSwapCells, findValidSwaps, isAdjacent, isValidSwap, swapPieces } from './moves.ts';
import { Rng } from './rng.ts';
import {
  allCells, anchorFor, blastArea, colCells, comboKind, rowCells, specialForGroup, squareCells,
} from './specials.ts';
import type { MadeSpecial } from './specials.ts';
import { starsFor } from './goals.ts';
import type { Goal, GoalProgress, LanternRule } from './goals.ts';
import type {
  Activation, Color, ComboKind, CascadeStep, Fall, GameEvent, MatchGroup, Move, Pos, Spawn, Swap, SwapResult,
} from './types.ts';
import { isPlainSwap } from './types.ts';

export const POINTS_PER_PIECE = 20;
/** Бонус за рождение спецфишки, не умножается на каскад. */
export const SPECIAL_BONUS: Readonly<Record<MadeSpecial, number>> = { lineH: 60, lineV: 60, bomb: 100, rainbow: 200 };
/** Очки за каждый удар по блокеру. */
export const BLOCKER_POINTS = 40;
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
  /** Блокеры по клеткам, символы — BLOCKER_CHARS (i I f k K m M v, . — нет). */
  readonly blockers?: readonly string[];
  readonly portals?: readonly Portal[];
  /** Пустой список — песочница: победы нет, партия идёт до конца ходов. */
  readonly goals?: readonly Goal[];
  readonly lanterns?: LanternRule;
  /** Пороги очков для 1, 2, 3 звёзд. */
  readonly stars?: readonly [number, number, number];
  /**
   * Скрытая помощь (PRD: динамическая сложность): шанс, что досыпанная фишка придёт лучом или бомбой.
   * Ставит сервер после серии поражений, игроку не показывается. См. assistForLossStreak.
   */
  readonly assist?: number;
  /**
   * Уровень на время (PRD, тип 6): секунды на партию. Время считает клиент и вызывает timeUp();
   * moves тогда — скрытый предел числа ходов. Партия идёт до конца таймера (цели не завершают её),
   * итог — при timeUp(): цели выполнены — победа. Бонуса за остаток нет.
   */
  readonly timeLimit?: number;
  /** Бустеры перед уровнем (PRD): луч + бомба на поле, радужный кристалл, +3 хода. */
  readonly startBoosters?: StartBoosters;
}

export interface StartBoosters {
  readonly beamBomb?: boolean;
  readonly rainbow?: boolean;
  readonly extraMoves?: boolean;
}

/** «+3 хода» перед уровнем. */
export const START_EXTRA_MOVES = 3;

/** PRD: после 5+ поражений подряд — мягкое облегчение, растущее с серией. */
export function assistForLossStreak(losses: number): number {
  if (losses < 5) return 0;
  return Math.min(0.06, 0.02 + 0.01 * (losses - 5));
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
  private _timedOut = false;
  private readonly _history: Move[] = [];
  private readonly jelly: number[][];
  private readonly jellyTotal: number;
  private jellyLeft: number;
  private readonly collectedByColor = new Map<Color, number>();
  private lanternsSpawned = 0;
  private lanternsCollected = 0;
  private fogCleared = 0;
  private fogClearedThisMove = false;

  constructor(options: GameOptions) {
    if (!Number.isInteger(options.moves) || options.moves < 1) throw new RangeError(`moves ${options.moves}`);
    if (options.assist !== undefined && !(options.assist >= 0 && options.assist <= 0.2)) throw new RangeError(`assist ${options.assist}`);
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
      this.applyBlockers(options.blockers);
      if (this.board.playableCells().some((p) => this.board.holdsPiece(p) && !this.board.get(p))) {
        throw new Error('layout has empty cells');
      }
      if (findMatches(this.board).length > 0) throw new Error('layout has ready matches');
      this.lanternsSpawned = this.board.playableCells().filter((p) => this.board.get(p)?.special === 'lantern').length;
    } else {
      this.board = new Board(options.width, options.height, options.colors, holes);
      this.applyBlockers(options.blockers);
      this.board.fillWithoutMatches(this.rng);
      this.placeStartLanterns();
    }
    for (const portal of options.portals ?? []) this.board.addPortal(portal);

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
    this.applyStartBoosters(options.startBoosters);
  }

  /**
   * Копия партии для примерки ходов (бот, подсказки). С seed копия получает другой ГПСЧ —
   * так примерка не подсматривает будущую досыпку. Историю такой копии воспроизводить нельзя.
   */
  clone(seed?: number): Match3Game {
    const copy = Object.create(Match3Game.prototype) as Match3Game;
    return Object.assign(copy, this, {
      board: this.board.clone(),
      rng: new Rng(seed ?? this.rng.state),
      _history: [...this._history],
      jelly: this.jelly.map((r) => [...r]),
      collectedByColor: new Map(this.collectedByColor),
    });
  }

  /** Время вышло (только для уровней с timeLimit). Партия, уже выигранная, не меняется. */
  /**
   * Время вышло (только для уровней с timeLimit). На уровне на время цели не завершают партию —
   * игрок набирает очки до конца таймера; итог решается здесь: цели выполнены — победа.
   */
  timeUp(): void {
    if (this.options.timeLimit === undefined) throw new Error('timeUp on a level without timeLimit');
    if (this.status === 'playing') this.settleTimed();
  }

  private goalsDone(): boolean {
    const goals = this.goalProgress();
    return goals.length > 0 && goals.every((g) => g.done);
  }

  private settleTimed(): void {
    if (this.goalsDone()) this._won = true;
    else this._timedOut = true;
  }

  static replay(options: GameOptions, moves: readonly Move[]): Match3Game {
    const game = new Match3Game(options);
    for (const [i, move] of moves.entries()) {
      if (!game.apply(move).valid) throw new Error(`replay: move #${i} is invalid`);
    }
    return game;
  }

  /** Любое действие из истории: свап, бустер или докупка ходов. */
  apply(move: Move): SwapResult {
    if (isPlainSwap(move)) return this.swap(move);
    if ('extraMoves' in move) return this.addMoves(move.extraMoves);
    return this.useBooster(move);
  }

  get movesLeft(): number {
    return this._movesLeft;
  }

  get score(): number {
    return this._score;
  }

  get history(): readonly Move[] {
    return this._history;
  }

  get status(): GameStatus {
    if (this._won) return 'won';
    if (this._timedOut) return 'lost';
    return this._movesLeft > 0 ? 'playing' : 'lost';
  }

  get stars(): 0 | 1 | 2 | 3 {
    return this.options.stars ? starsFor(this._score, this.options.stars, this._won) : 0;
  }

  /** Бустеры перед уровнем: спецфишки ставятся на случайные обычные фишки (по сиду — реплей сходится). */
  private applyStartBoosters(b: StartBoosters | undefined): void {
    if (!b) return;
    if (b.extraMoves) this._movesLeft += START_EXTRA_MOVES;
    const cells = this.rng.shuffle(this.board.playableCells()
      .filter((p) => this.board.isMovable(p) && this.board.get(p)?.special === 'none'));
    const take = () => cells.pop();
    if (b.beamBomb) {
      for (const special of [this.rng.int(2) === 0 ? 'lineH' : 'lineV', 'bomb'] as const) {
        const at = take();
        if (at) this.board.set(at, Board.withSpecial(this.board.get(at)!, special));
      }
    }
    if (b.rainbow) {
      const at = take();
      if (at) this.board.set(at, this.board.makeRainbow());
    }
    // радуга без цвета могла лишить поле ходов
    this.ensurePlayable();
  }

  private applyBlockers(rows: readonly string[] | undefined): void {
    if (!rows) return;
    const { width, height } = this.options;
    if (rows.length !== height || rows.some((r) => r.length !== width)) throw new Error(`blockers must be ${width}x${height}`);
    rows.forEach((line, row) => [...line].forEach((ch, col) => {
      const b = BLOCKER_CHARS[ch];
      if (b === undefined) throw new Error(`blockers: bad char '${ch}' at ${row},${col}`);
      if (!b) return;
      const at = { row, col };
      if (!this.board.isPlayable(at)) throw new Error(`blockers: blocker on a hole at ${row},${col}`);
      if (b.kind !== 'vines' && this.board.get(at)) throw new Error(`layout: cell ${row},${col} under ${b.kind} must be '.'`);
      if (b.kind === 'vines' && this.options.layout && !this.board.get(at)) throw new Error(`layout: vines at ${row},${col} need a piece`);
      this.board.setBlocker(at, b);
    }));
  }

  get fogOnBoard(): number {
    return this.board.playableCells().filter((p) => this.board.blockerAt(p)?.kind === 'fog').length;
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
        case 'fog': {
          const left = this.fogOnBoard;
          return { goal, current: this.fogCleared, target: this.fogCleared + left, done: left === 0 };
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
      const adjacent = this.board.isMovable(swap.a) && this.board.isMovable(swap.b) && isAdjacent(swap.a, swap.b);
      return { valid: false, events: adjacent ? [{ type: 'swap', swap }, { type: 'swapBack', swap }] : [] };
    }

    const events: GameEvent[] = [{ type: 'swap', swap }];
    swapPieces(this.board, swap);
    this._movesLeft--;
    this._history.push(swap);
    this.fogClearedThisMove = false;

    this.settle(events, this.comboPlan(swap), [swap.b, swap.a], true);
    return { valid: true, events };
  }

  /**
   * Развязка после действия: каскады, затем победа, предел времени, рост тумана (только после хода),
   * перемешивание, если ходов не осталось.
   */
  private settle(events: GameEvent[], first: StepPlan | null, preferred: Pos[], isMove: boolean): void {
    for (let index = 0; index < MAX_CASCADES; index++) {
      const plan: StepPlan | null = index === 0 && first ? first : this.matchPlan(index === 0 ? preferred : []);
      if (!plan) break;
      events.push({ type: 'cascade', step: this.resolveStep(index, plan), index });
    }
    const timed = this.options.timeLimit !== undefined;
    if (!timed && this.goalsDone()) {
      this._won = true;
      const bonus = this._movesLeft * FINALE_BONUS_PER_MOVE;
      this._score += bonus;
      events.push({ type: 'finale', movesLeft: this._movesLeft, bonus });
    } else if (timed && this._movesLeft === 0) {
      // предел ходов на уровне на время — как истёкшее время
      this.settleTimed();
    } else {
      if (isMove) {
        const spread = this.spreadFog();
        if (spread) events.push(spread);
      }
      events.push(...this.ensurePlayable());
    }
  }

  /** Бустер во время игры. Ход не тратит; недопустимый бустер ничего не меняет. */
  useBooster(move: Extract<Move, { booster: string }>): SwapResult {
    if (this.status !== 'playing') return { valid: false, events: [] };
    const events: GameEvent[] = [];
    if (move.booster === 'hammer') {
      const { at } = move;
      const piece = this.board.get(at);
      const hasBlocker = this.board.isPlayable(at) && this.board.blockerAt(at) !== null;
      // фонарик молотом не разбить — его можно только довести вниз
      if (!this.board.isPlayable(at) || (!hasBlocker && (!piece || piece.special === 'lantern'))) return { valid: false, events: [] };
      this._history.push(move);
      events.push({ type: 'booster', booster: 'hammer', at });
      this.settle(events, { combo: null, groups: [], targets: [at], consumed: [], preferred: [] }, [], false);
      return { valid: true, events };
    }
    if (move.booster === 'freeSwap') {
      const swap = { a: move.a, b: move.b };
      if (!canSwapCells(this.board, swap)) return { valid: false, events: [] };
      this._history.push(move);
      events.push({ type: 'booster', booster: 'freeSwap', at: move.a }, { type: 'swap', swap });
      swapPieces(this.board, swap);
      this.settle(events, this.comboPlan(swap), [swap.b, swap.a], false);
      return { valid: true, events };
    }
    this._history.push(move);
    events.push({ type: 'booster', booster: 'shuffle' }, ...this.shuffleBoard());
    return { valid: true, events };
  }

  /**
   * Докупка ходов (окно «+5 ходов»): только когда ходы кончились и цели не выполнены.
   * На уровне на время не работает — там нет счёта ходов.
   */
  addMoves(n: number): SwapResult {
    const outOfMoves = !this._won && !this._timedOut && this._movesLeft === 0;
    if (!outOfMoves || this.options.timeLimit !== undefined || !Number.isInteger(n) || n < 1 || n > 10) {
      return { valid: false, events: [] };
    }
    this._movesLeft += n;
    this._history.push({ extraMoves: n });
    return { valid: true, events: [{ type: 'extraMoves', moves: n }, ...this.ensurePlayable()] };
  }

  get extraMovesBought(): number {
    return this._history.filter((m) => 'extraMoves' in m).length;
  }

  /** Сколько раз использован каждый бустер — сервер списывает их со склада игрока. */
  boostersUsed(): Record<'hammer' | 'freeSwap' | 'shuffle', number> {
    const used = { hammer: 0, freeSwap: 0, shuffle: 0 };
    for (const m of this._history) if ('booster' in m) used[m.booster]++;
    return used;
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


    const activations: Activation[] = [];
    const hit = new Map<string, Pos>();
    const queue: Pos[] = [...plan.groups.flatMap((g) => g.cells), ...plan.targets];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      if (cleared.has(key(p)) || hit.has(key(p))) continue;
      // блокер в клетке принимает удар на себя: лианы держат фишку, остальные занимают клетку
      if (this.board.blockerAt(p)) {
        hit.set(key(p), p);
        continue;
      }
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

    // спецфишки рождаются на снятых клетках группы (клетка под лианами не снята — её фишку не трогаем)
    const toCreate: { at: Pos; special: MadeSpecial; color: Color }[] = [];
    for (const g of plan.groups) {
      const special = specialForGroup(g);
      if (!special) continue;
      const anchor = anchorFor(g, plan.preferred);
      const at = cleared.has(key(anchor)) ? anchor : g.cells.find((p) => cleared.has(key(p)));
      if (at && !toCreate.some((c) => key(c.at) === key(at))) toCreate.push({ at, special, color: g.color });
    }

    // соседний матч бьёт лёд, туман и сундуки (не дайфуку и не лианы)
    for (const g of plan.groups) {
      for (const p of g.cells) {
        if (!cleared.has(key(p))) continue;
        for (const q of [{ row: p.row - 1, col: p.col }, { row: p.row + 1, col: p.col }, { row: p.row, col: p.col - 1 }, { row: p.row, col: p.col + 1 }]) {
          const kind = this.board.blockerAt(q)?.kind;
          if (kind === 'ice' || kind === 'fog' || kind === 'chest') hit.set(key(q), q);
        }
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

    const blockersHit: { at: Pos; kind: BlockerKind; layersLeft: number }[] = [];
    for (const p of hit.values()) {
      const before = this.board.blockerAt(p)!;
      const after = damage(before);
      this.board.setBlocker(p, after);
      blockersHit.push({ at: p, kind: before.kind, layersLeft: layersOf(after) });
      if (before.kind === 'fog') {
        this.fogCleared++;
        this.fogClearedThisMove = true;
      }
      if (before.kind === 'chest' && !after) {
        const special = (['lineH', 'lineV', 'bomb'] as const)[this.rng.int(3)]!;
        const piece = this.board.makePiece(this.board.randomColor(this.rng), special);
        this.board.set(p, piece);
        created.push({ piece, at: p });
      }
    }

    // бонус — только за спецфишки из матчей, не из сундуков
    const bonus = toCreate.reduce((sum, c) => sum + SPECIAL_BONUS[c.special], 0);
    const scoreGained = cleared.size * POINTS_PER_PIECE * (index + 1) + bonus + blockersHit.length * BLOCKER_POINTS;
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
      created, blockersHit, jellyHit, lanternsCollected, falls, spawns, scoreGained,
    };
  }

  /** Фонарики на нижней клетке своего столбца. */
  private lanternsAtExits(): { id: number; at: Pos }[] {
    const exits: { id: number; at: Pos }[] = [];
    for (const at of this.board.lanternExits()) {
      const piece = this.board.get(at);
      if (piece?.special === 'lantern') exits.push({ id: piece.id, at });
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
    const tops = this.rng.shuffle(Array.from({ length: this.board.width }, (_, col) => this.board.columnCells(col)
      .find((p) => this.board.isMovable(p))).filter((p): p is Pos => p !== undefined));
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

  /** Фишки падают по путям падения: вниз, сквозь дыры и блокеры, через порталы. */
  private applyGravity(): Fall[] {
    const falls: Fall[] = [];
    for (const cells of this.board.fallPaths()) {
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
    const empty = this.board.playableCells().filter((p) => this.board.holdsPiece(p) && !this.board.get(p));
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
        const color = this.board.randomColor(this.rng);
        const assist = this.options.assist ?? 0;
        const special = assist > 0 && this.rng.next() < assist ? (['lineH', 'lineV', 'bomb'] as const)[this.rng.int(3)]! : 'none';
        piece = this.board.makePiece(color, special);
      }
      this.board.set(at, piece);
      return { piece, at };
    });
  }

  /** Туман расползается, если за ход его не тронули: съедает соседнюю обычную фишку. */
  private spreadFog(): GameEvent | null {
    if (this.fogClearedThisMove) return null;
    const options: { from: Pos; to: Pos }[] = [];
    for (const from of this.board.playableCells()) {
      if (this.board.blockerAt(from)?.kind !== 'fog') continue;
      for (const to of [{ row: from.row - 1, col: from.col }, { row: from.row, col: from.col + 1 },
        { row: from.row + 1, col: from.col }, { row: from.row, col: from.col - 1 }]) {
        if (this.board.isMovable(to) && this.board.get(to)?.special === 'none') options.push({ from, to });
      }
    }
    if (options.length === 0) return null;
    const { from, to } = options[this.rng.int(options.length)]!;
    const pieceId = this.board.get(to)!.id;
    this.board.set(to, null);
    this.board.setBlocker(to, { kind: 'fog' });
    return { type: 'fogSpread', from, to, pieceId };
  }

  /** Если ходов нет — перемешать; если и это не помогло — собрать поле заново. */
  private ensurePlayable(): GameEvent[] {
    if (findValidSwaps(this.board).length > 0) return [];
    return this.shuffleBoard();
  }

  /** Перемешать поле так, чтобы не было готовых матчей и был ход; не вышло — собрать заново. */
  private shuffleBoard(): GameEvent[] {
    // перемешиваются только подвижные фишки: лианы и блокеры остаются на местах
    const cells = this.board.playableCells().filter((p) => this.board.isMovable(p));
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
    const locked = this.board.playableCells().filter((p) => this.board.holdsPiece(p) && !this.board.isMovable(p))
      .map((at) => ({ at, piece: this.board.get(at)! }));
    const lanterns = cells.flatMap((at) => (this.board.get(at)?.special === 'lantern' ? [{ at, piece: this.board.get(at)! }] : []));
    for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt++) {
      this.board.fillWithoutMatches(this.rng);
      for (const { at, piece } of [...lanterns, ...locked]) this.board.set(at, piece);
      if (findMatches(this.board).length === 0 && findValidSwaps(this.board).length > 0) {
        return [{ type: 'reset', pieces: cells.map((at) => ({ piece: this.board.get(at)!, at })) }];
      }
    }
    throw new Error('board has no valid moves after reset');
  }
}
