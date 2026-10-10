import type { Blocker, Portal } from './blockers.ts';
import { occupiesCell } from './blockers.ts';
import type { Rng } from './rng.ts';
import type { Color, Grid, Piece, Pos, Special } from './types.ts';
import { MAX_COLORS, MAX_SIZE, MIN_COLORS } from './types.ts';

const key = (p: Pos) => `${p.row},${p.col}`;

export class Board {
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly grid: Grid;
  /** Дыры — клетки вне поля: в них нет фишек, сквозь них падают. */
  private readonly holes: ReadonlySet<string>;
  private readonly blockers: (Blocker | null)[][];
  /** Порталы: ключ входа → выход, ключ выхода → вход. */
  private readonly portalOut = new Map<string, Pos>();
  private readonly portalIn = new Map<string, Pos>();
  private nextId = 1;

  constructor(width: number, height: number, colors: number, holes: readonly Pos[] = []) {
    if (!Number.isInteger(width) || width < 3 || width > MAX_SIZE) throw new RangeError(`width ${width}`);
    if (!Number.isInteger(height) || height < 3 || height > MAX_SIZE) throw new RangeError(`height ${height}`);
    if (!Number.isInteger(colors) || colors < MIN_COLORS || colors > MAX_COLORS) throw new RangeError(`colors ${colors}`);
    this.width = width;
    this.height = height;
    this.colors = colors;
    this.grid = Array.from({ length: height }, () => Array<Piece | null>(width).fill(null));
    this.holes = new Set(holes.map(key));
    this.blockers = Array.from({ length: height }, () => Array<Blocker | null>(width).fill(null));
  }

  blockerAt(p: Pos): Blocker | null {
    return this.blockers[p.row]?.[p.col] ?? null;
  }

  setBlocker(p: Pos, b: Blocker | null): void {
    if (b && !this.isPlayable(p)) throw new RangeError(`blocker outside the board at ${p.row},${p.col}`);
    if (occupiesCell(b) && this.get(p)) throw new RangeError(`cell ${p.row},${p.col} still has a piece`);
    this.blockers[p.row]![p.col] = b;
  }

  /** В клетке может лежать фишка (не дыра и не занята блокером). */
  holdsPiece(p: Pos): boolean {
    return this.isPlayable(p) && !occupiesCell(this.blockerAt(p));
  }

  /** Фишку можно двигать: свапом, гравитацией, перемешиванием. */
  isMovable(p: Pos): boolean {
    return this.holdsPiece(p) && this.blockerAt(p)?.kind !== 'vines';
  }

  addPortal({ from, to }: Portal): void {
    if (!this.isPlayable(from) || !this.isPlayable(to)) throw new RangeError('portal ends must be on the board');
    if (this.portalOut.has(key(from)) || this.portalIn.has(key(to))) throw new RangeError('portal cell already used');
    this.portalOut.set(key(from), to);
    this.portalIn.set(key(to), from);
    // путь из выхода не должен вернуться во вход — иначе фишки падали бы по кругу
    const seen = new Set<string>();
    for (let p: Pos | null = to; p; p = this.below(p)) {
      if (seen.has(key(p))) {
        this.portalOut.delete(key(from));
        this.portalIn.delete(key(to));
        throw new RangeError(`portal ${from.row},${from.col} → ${to.row},${to.col} makes a loop`);
      }
      seen.add(key(p));
    }
  }

  /** Следующая клетка по пути падения: через портал или вниз, пропуская дыры. */
  private below(p: Pos): Pos | null {
    const out = this.portalOut.get(key(p));
    if (out) return out;
    for (let row = p.row + 1; row < this.height; row++) {
      const q = { row, col: p.col };
      if (this.isHole(q)) continue;
      // в выход портала сверху ничего не падает — только из входа
      return this.portalIn.has(key(q)) ? null : q;
    }
    return null;
  }

  /**
   * Пути падения: от верхней клетки к нижней, с переходами через порталы.
   * Возвращаются только подвижные клетки — сквозь блокеры и лианы фишки пролетают.
   */
  fallPaths(): Pos[][] {
    const hasPred = new Set<string>();
    for (const p of this.playableCells()) {
      const b = this.below(p);
      if (b) hasPred.add(key(b));
    }
    const paths: Pos[][] = [];
    for (const start of this.playableCells()) {
      if (hasPred.has(key(start))) continue;
      const path: Pos[] = [];
      for (let p: Pos | null = start; p; p = this.below(p)) path.push(p);
      paths.push(path.filter((q) => this.isMovable(q)));
    }
    return paths;
  }

  /**
   * Клетки, где новые фишки появляются «из ниоткуда» посреди поля: начало пути падения, прямо над которым
   * игровая клетка (вход портала уводит фишки в другое место, а сверху сюда ничего не падает).
   * Для линта уровней: такая клетка выглядит как баг — фишки возникают под портальным входом.
   */
  orphanSpawns(): { cell: Pos; above: Pos }[] {
    const hasPred = new Set<string>();
    for (const p of this.playableCells()) {
      const b = this.below(p);
      if (b) hasPred.add(key(b));
    }
    const out: { cell: Pos; above: Pos }[] = [];
    for (const start of this.playableCells()) {
      if (hasPred.has(key(start)) || start.row === 0) continue;
      // дыра прямо над клеткой — видимый «край» поля, появление фишек оттуда выглядит естественно
      const above = { row: start.row - 1, col: start.col };
      if (!this.isHole(above)) out.push({ cell: start, above });
    }
    return out;
  }

  /** Низ поля для фонариков: путь падения заканчивается в самой нижней клетке столбца. */
  lanternExits(): Pos[] {
    const exits: Pos[] = [];
    const hasPred = new Set<string>();
    for (const p of this.playableCells()) {
      const b = this.below(p);
      if (b) hasPred.add(key(b));
    }
    for (const start of this.playableCells()) {
      if (hasPred.has(key(start))) continue;
      let last = start;
      let lastMovable: Pos | null = null;
      for (let p: Pos | null = start; p; p = this.below(p)) {
        last = p;
        if (this.isMovable(p)) lastMovable = p;
      }
      const bottom = this.columnCells(last.col).at(-1);
      if (lastMovable && bottom && key(bottom) === key(last)) exits.push(lastMovable);
    }
    return exits;
  }

  /** Независимая копия: фишки и блокеры неизменяемы, копируются только сетки. Порталы общие — они не меняются. */
  clone(): Board {
    const copy = Object.create(Board.prototype) as Board;
    return Object.assign(copy, this, {
      grid: this.grid.map((r) => [...r]),
      blockers: this.blockers.map((r) => [...r]),
    });
  }

  inBounds(p: Pos): boolean {
    return p.row >= 0 && p.row < this.height && p.col >= 0 && p.col < this.width;
  }

  isHole(p: Pos): boolean {
    return this.holes.has(key(p));
  }

  /** Клетка поля (в границах и не дыра). */
  isPlayable(p: Pos): boolean {
    return this.inBounds(p) && !this.isHole(p);
  }

  playableCells(): Pos[] {
    const cells: Pos[] = [];
    for (let row = 0; row < this.height; row++)
      for (let col = 0; col < this.width; col++) if (!this.isHole({ row, col })) cells.push({ row, col });
    return cells;
  }

  /** Клетки столбца сверху вниз без дыр — по ним падают фишки. */
  columnCells(col: number): Pos[] {
    const cells: Pos[] = [];
    for (let row = 0; row < this.height; row++) if (!this.isHole({ row, col })) cells.push({ row, col });
    return cells;
  }

  get(p: Pos): Piece | null {
    return this.grid[p.row]?.[p.col] ?? null;
  }

  set(p: Pos, piece: Piece | null): void {
    const row = this.grid[p.row];
    if (!row || p.col < 0 || p.col >= this.width) throw new RangeError(`out of bounds ${p.row},${p.col}`);
    if (piece && this.isHole(p)) throw new RangeError(`hole at ${p.row},${p.col}`);
    if (piece && occupiesCell(this.blockerAt(p))) throw new RangeError(`blocker at ${p.row},${p.col}`);
    row[p.col] = piece;
  }

  /** Цвет для поиска матчей; у радуги, фонарика и пустой клетки — undefined. */
  colorAt(row: number, col: number): Color | undefined {
    return this.grid[row]?.[col]?.color ?? undefined;
  }

  makePiece(color: Color, special: 'none' | 'lineH' | 'lineV' | 'bomb' = 'none'): Piece {
    return { id: this.nextId++, color, special };
  }

  makeRainbow(): Piece {
    return { id: this.nextId++, color: null, special: 'rainbow' };
  }

  makeLantern(): Piece {
    return { id: this.nextId++, color: null, special: 'lantern' };
  }

  /** Та же фишка (тот же id) с другим типом — для превращений в комбо с радугой. */
  static withSpecial(piece: Piece, special: 'lineH' | 'lineV' | 'bomb'): Piece {
    return { ...piece, special };
  }

  randomColor(rng: Rng): Color {
    return rng.int(this.colors) as Color;
  }

  /** Заполняет поле так, чтобы на старте не было готовых троек. */
  fillWithoutMatches(rng: Rng): void {
    for (const { row, col } of this.playableCells()) {
      if (!this.holdsPiece({ row, col })) continue;
      const banned = new Set<Color>();
      const l1 = this.colorAt(row, col - 1);
      if (l1 !== undefined && l1 === this.colorAt(row, col - 2)) banned.add(l1);
      const u1 = this.colorAt(row - 1, col);
      if (u1 !== undefined && u1 === this.colorAt(row - 2, col)) banned.add(u1);
      const options: Color[] = [];
      for (let c = 0; c < this.colors; c++) if (!banned.has(c as Color)) options.push(c as Color);
      this.set({ row, col }, this.makePiece(options[rng.int(options.length)]!));
    }
  }

  /** Строки для отладки и тестов. Формат как у fromStrings, но тип луча/бомбы не виден; # — клетка под блокером. */
  toStrings(): string[] {
    return this.grid.map((r, row) => r.map((p, col) => {
      if (this.isHole({ row, col })) return '_';
      if (occupiesCell(this.blockerAt({ row, col }))) return '#';
      if (!p) return '.';
      if (p.special === 'rainbow') return '*';
      if (p.special === 'lantern') return 'L';
      return String(p.color);
    }).join(''));
  }

  /**
   * Поле из строк — для тестов и редактора уровней.
   * Цифра — обычная фишка; после цифры можно указать тип: h (lineH), v (lineV), b (bomb).
   * * — радуга, L — фонарик, _ — дыра, точка — пусто. Пример: ['01h2', '1*L_'].
   */
  static fromStrings(rows: readonly string[], colors = MAX_COLORS): Board {
    const tokens = rows.map((line) => line.match(/\d[hvb]?|[*L_.]/g) ?? []);
    rows.forEach((line, row) => {
      if (tokens[row]!.join('') !== line) throw new Error(`row ${row}: bad cell syntax '${line}'`);
    });
    const height = rows.length;
    const width = tokens[0]?.length ?? 0;
    const holes: Pos[] = [];
    tokens.forEach((cells, row) => {
      if (cells.length !== width) throw new Error(`row ${row} has ${cells.length} cells, expected ${width}`);
      cells.forEach((tok, col) => { if (tok === '_') holes.push({ row, col }); });
    });
    const board = new Board(width, height, colors, holes);
    tokens.forEach((cells, row) => {
      cells.forEach((tok, col) => {
        const at = { row, col };
        if (tok === '.' || tok === '_') return;
        if (tok === '*') return board.set(at, board.makeRainbow());
        if (tok === 'L') return board.set(at, board.makeLantern());
        const c = Number(tok[0]);
        if (c >= colors) throw new Error(`bad color '${tok}' at ${row},${col}`);
        const special = ({ h: 'lineH', v: 'lineV', b: 'bomb' } as const)[tok[1] as 'h' | 'v' | 'b'] ?? 'none';
        board.set(at, board.makePiece(c as Color, special));
      });
    });
    return board;
  }
}
