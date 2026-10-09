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

  /** Строки для отладки и тестов. Формат как у fromStrings, но тип луча/бомбы не виден. */
  toStrings(): string[] {
    return this.grid.map((r, row) => r.map((p, col) => {
      if (this.isHole({ row, col })) return '_';
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
