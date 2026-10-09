import type { Rng } from './rng.ts';
import type { Color, Grid, Piece, Pos } from './types.ts';
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

  colorAt(row: number, col: number): Color | undefined {
    return this.grid[row]?.[col]?.color;
  }

  makePiece(color: Color): Piece {
    return { id: this.nextId++, color };
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

  /** Строки для отладки и тестов: цифра — цвет, точка — пусто. */
  toStrings(): string[] {
    return this.grid.map((r) => r.map((p) => (p ? String(p.color) : '.')).join(''));
  }

  /** Поле из строк вида ['012', '120', ...] — для тестов и редактора уровней. */
  static fromStrings(rows: string[], colors = MAX_COLORS): Board {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const board = new Board(width, height, colors);
    rows.forEach((line, row) => {
      if (line.length !== width) throw new Error(`row ${row} has length ${line.length}, expected ${width}`);
      [...line].forEach((ch, col) => {
        if (ch === '.') return;
        const c = Number(ch);
        if (!Number.isInteger(c) || c < 0 || c >= colors) throw new Error(`bad color '${ch}' at ${row},${col}`);
        board.set({ row, col }, board.makePiece(c as Color));
      });
    });
    return board;
  }
}
