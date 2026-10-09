import type { Board } from './board.ts';
import type { Color, MatchGroup, Pos } from './types.ts';

interface Run {
  color: Color;
  cells: Pos[];
}

function scanRuns(board: Board): Run[] {
  const runs: Run[] = [];
  const scan = (outer: number, inner: number, at: (o: number, i: number) => Pos) => {
    for (let o = 0; o < outer; o++) {
      let start = 0;
      for (let i = 1; i <= inner; i++) {
        const prev = board.get(at(o, start));
        const cur = i < inner ? board.get(at(o, i)) : null;
        if (cur && prev && cur.color === prev.color) continue;
        if (prev && i - start >= 3) {
          const cells: Pos[] = [];
          for (let k = start; k < i; k++) cells.push(at(o, k));
          runs.push({ color: prev.color, cells });
        }
        start = i;
      }
    }
  };
  scan(board.height, board.width, (row, col) => ({ row, col }));
  scan(board.width, board.height, (col, row) => ({ row, col }));
  return runs;
}

/**
 * Все совпадения на поле. Линии одного цвета, делящие клетку, сливаются в одну
 * группу — так L/T-фигуры видны целиком (понадобится для бомб на этапе 2).
 */
export function findMatches(board: Board): MatchGroup[] {
  const runs = scanRuns(board);
  const parent = runs.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));

  const owner = new Map<string, number>();
  runs.forEach((run, i) => {
    for (const p of run.cells) {
      const key = `${p.row},${p.col}`;
      const other = owner.get(key);
      if (other === undefined) owner.set(key, i);
      else parent[root(i)] = root(other);
    }
  });

  const byRoot = new Map<number, Run[]>();
  runs.forEach((run, i) => {
    const r = root(i);
    byRoot.set(r, [...(byRoot.get(r) ?? []), run]);
  });

  const groups: MatchGroup[] = [];
  for (const members of byRoot.values()) {
    const seen = new Map<string, Pos>();
    for (const run of members) for (const p of run.cells) seen.set(`${p.row},${p.col}`, p);
    const rows = new Set(members.flatMap((r) => r.cells.map((p) => p.row)));
    const cols = new Set(members.flatMap((r) => r.cells.map((p) => p.col)));
    groups.push({
      color: members[0]!.color,
      cells: [...seen.values()],
      longestLine: Math.max(...members.map((r) => r.cells.length)),
      isCross: rows.size > 1 && cols.size > 1,
    });
  }
  return groups;
}

/** Есть ли тройка, проходящая через клетку p (быстрая проверка для поиска ходов). */
export function hasMatchAt(board: Board, p: Pos): boolean {
  const piece = board.get(p);
  if (!piece) return false;
  const count = (dr: number, dc: number) => {
    let n = 0;
    for (let r = p.row + dr, c = p.col + dc; board.colorAt(r, c) === piece.color; r += dr, c += dc) n++;
    return n;
  };
  return count(0, -1) + count(0, 1) >= 2 || count(-1, 0) + count(1, 0) >= 2;
}
