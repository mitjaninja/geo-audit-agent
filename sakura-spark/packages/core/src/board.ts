import type { Rng } from './rng.ts';
import type { Color, Grid, Piece, Pos, Special } from './types.ts';
import { MAX_COLORS, MAX_SIZE, MIN_COLORS } from './types.ts';

export class Board {
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly grid: Grid;
  private nextId = 1;

  constructor(width: number, height: number, colors: number) {
    if (!Number.isInteger(width) || width < 3 || width > MAX_SIZE) throw new RangeError(`width ${width}`);
    if (!Number.isInteger(height) || height < 3 || height > MAX_SIZE) throw new RangeError(`height ${height}`);
    if (!Number.isInteger(colors) || colors < MIN_COLORS || colors > MAX_COLORS) throw new RangeError(`colors ${colors}`);
    this.width = width;
    this.height = height;
    this.colors = colors;
    this.grid = Array.from({ length: height }, () => Array<Piece | null>(width).fill(null));
  }

  inBounds(p: Pos): boolean {
    return p.row >= 0 && p.row < this.height && p.col >= 0 && p.col < this.width;
  }

  get(p: Pos): Piece | null {
    return this.grid[p.row]?.[p.col] ?? null;
  }

  set(p: Pos, piece: Piece | null): void {
    const row = this.grid[p.row];
    if (!row || p.col < 0 || p.col >= this.width) throw new RangeError(`out of bounds ${p.row},${p.col}`);
    row[p.col] = piece;
  }

  /** Цвет для поиска матчей; у радуги и пустой клетки — undefined. */
  colorAt(row: number, col: number): Color | undefined {
    return this.grid[row]?.[col]?.color ?? undefined;
  }

  makePiece(color: Color, special: Exclude<Special, 'rainbow'> = 'none'): Piece {
    return { id: this.nextId++, color, special };
  }

  makeRainbow(): Piece {
    return { id: this.nextId++, color: null, special: 'rainbow' };
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
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
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
  }

  /** Строки для отладки и тестов: цифра — цвет, * — радуга, точка — пусто. Тип луча/бомбы не виден. */
  toStrings(): string[] {
    return this.grid.map((r) => r.map((p) => (p ? (p.color === null ? '*' : String(p.color)) : '.')).join(''));
  }

  /**
   * Поле из строк — для тестов и редактора уровней.
   * Цифра — обычная фишка; после цифры можно указать тип: h (lineH), v (lineV), b (bomb).
   * * — радуга, точка — пусто. Пример: ['01h2', '1*20'].
   */
  static fromStrings(rows: string[], colors = MAX_COLORS): Board {
    const tokens = rows.map((line) => line.match(/\d[hvb]?|\*|\./g) ?? []);
    rows.forEach((line, row) => {
      if (tokens[row]!.join('') !== line) throw new Error(`row ${row}: bad cell syntax '${line}'`);
    });
    const height = rows.length;
    const width = tokens[0]?.length ?? 0;
    const board = new Board(width, height, colors);
    tokens.forEach((cells, row) => {
      if (cells.length !== width) throw new Error(`row ${row} has ${cells.length} cells, expected ${width}`);
      cells.forEach((tok, col) => {
        if (tok === '.') return;
        if (tok === '*') return board.set({ row, col }, board.makeRainbow());
        const c = Number(tok[0]);
        if (c >= colors) throw new Error(`bad color '${tok}' at ${row},${col}`);
        const special = ({ h: 'lineH', v: 'lineV', b: 'bomb' } as const)[tok[1] as 'h' | 'v' | 'b'] ?? 'none';
        board.set({ row, col }, board.makePiece(c as Color, special));
      });
    });
    return board;
  }
}
