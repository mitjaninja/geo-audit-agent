/**
 * Модель редактора уровней (без DOM — с тестами): черновик уровня в формате JSON, кисти по слоям,
 * изменение размера, порталы, проверка валидатором ядра и линтом.
 */
import { LevelError, lintLevel, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';

export type Layer = 'shape' | 'jelly' | 'blockers' | 'portals';
export type Raw = Record<string, unknown> & { width: number; height: number };

/** Кисти слоя: символ в сетке уровня и подпись. */
export const BRUSHES: Readonly<Record<Exclude<Layer, 'portals'>, readonly { readonly ch: string; readonly label: string }[]>> = {
  shape: [{ ch: '#', label: 'клетка' }, { ch: '_', label: 'дыра' }],
  jelly: [{ ch: '0', label: 'нет' }, { ch: '1', label: 'желе' }, { ch: '2', label: 'желе ×2' }],
  blockers: [
    { ch: '.', label: 'нет' }, { ch: 'i', label: 'лёд' }, { ch: 'I', label: 'лёд ×2' }, { ch: 'f', label: 'туман' },
    { ch: 'k', label: 'сундук' }, { ch: 'K', label: 'сундук ×2' }, { ch: 'm', label: 'дайфуку' }, { ch: 'M', label: 'дайфуку ×2' },
    { ch: 'v', label: 'лианы' },
  ],
};
const EMPTY: Readonly<Record<Exclude<Layer, 'portals'>, string>> = { shape: '#', jelly: '0', blockers: '.' };

export function blankLevel(id: number, width = 8, height = 8): Raw {
  return {
    id, width, height, colors: 5, moves: 20, difficulty: 'normal',
    goals: [{ type: 'score', target: 5000 }], stars: [5000, 8000, 11000],
  };
}

const grid = (raw: Raw, layer: Exclude<Layer, 'portals'>): string[] =>
  (raw[layer] as string[] | undefined) ?? Array.from({ length: raw.height }, () => EMPTY[layer].repeat(raw.width));

const isHole = (raw: Raw, r: number, c: number) => grid(raw, 'shape')[r]?.[c] === '_';

/** Слой без единого непустого символа не пишем в JSON — так уровни остаются короткими. */
function store(raw: Raw, layer: Exclude<Layer, 'portals'>, g: string[]): Raw {
  const empty = g.every((row) => [...row].every((ch) => ch === EMPTY[layer] || (layer !== 'shape' && ch === '_')));
  const { [layer]: _, ...rest } = raw;
  return (empty ? rest : { ...rest, [layer]: g }) as Raw;
}

const setCh = (row: string, c: number, ch: string) => row.slice(0, c) + ch + row.slice(c + 1);

/** Покрасить клетку. Дыра стирает желе и блокеры в ней; на дыре желе и блокеров не бывает. */
export function paint(raw: Raw, layer: Exclude<Layer, 'portals'>, r: number, c: number, ch: string): Raw {
  if (layer !== 'shape' && isHole(raw, r, c)) return raw;
  let next = store(raw, layer, grid(raw, layer).map((row, i) => (i === r ? setCh(row, c, ch) : row)));
  if (layer === 'shape') {
    const hole = ch === '_';
    if (next.jelly) next = store(next, 'jelly', grid(next, 'jelly').map((row, i) => (i === r ? setCh(row, c, hole ? '_' : '0') : row)));
    if (hole && next.blockers) next = store(next, 'blockers', grid(next, 'blockers').map((row, i) => (i === r ? setCh(row, c, '.') : row)));
    if (hole) next = { ...next, portals: portals(next).filter((p) => !same(p.from, [r, c]) && !same(p.to, [r, c])) };
    if ((next.portals as unknown[] | undefined)?.length === 0) delete next.portals;
  }
  return next;
}

export const cell = (raw: Raw, layer: Exclude<Layer, 'portals'>, r: number, c: number): string => grid(raw, layer)[r]![c]!;

type P = { from: [number, number]; to: [number, number] };
const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];
export const portals = (raw: Raw): P[] => (raw.portals as P[] | undefined) ?? [];

/** Портал: первый тап — вход, второй — выход. Тап по существующему концу портала удаляет его. */
export function portalTap(raw: Raw, pending: [number, number] | null, r: number, c: number): { raw: Raw; pending: [number, number] | null } {
  const ps = portals(raw);
  const hit = ps.findIndex((p) => same(p.from, [r, c]) || same(p.to, [r, c]));
  if (hit >= 0) {
    const rest = ps.filter((_, i) => i !== hit);
    const { portals: _, ...without } = raw;
    return { raw: (rest.length ? { ...without, portals: rest } : without) as Raw, pending: null };
  }
  if (isHole(raw, r, c)) return { raw, pending };
  if (!pending) return { raw, pending: [r, c] };
  if (same(pending, [r, c])) return { raw, pending: null };
  return { raw: { ...raw, portals: [...ps, { from: pending, to: [r, c] }] }, pending: null };
}

/** Новый размер: сетки обрезаются или дополняются пустыми клетками, порталы за краем удаляются. */
export function resize(raw: Raw, width: number, height: number): Raw {
  let next: Raw = { ...raw, width, height };
  for (const layer of ['shape', 'jelly', 'blockers'] as const) {
    if (!raw[layer]) continue;
    const g = Array.from({ length: height }, (_, r) => {
      const row = grid(raw, layer)[r] ?? '';
      return (row + EMPTY[layer].repeat(width)).slice(0, width);
    });
    next = store(next, layer, g);
  }
  const inside = (p: readonly number[]) => p[0]! < height && p[1]! < width;
  const ps = portals(raw).filter((p) => inside(p.from) && inside(p.to));
  if (raw.portals) {
    const { portals: _, ...rest } = next;
    next = (ps.length ? { ...rest, portals: ps } : rest) as Raw;
  }
  return next;
}

export interface Check {
  readonly level: LevelDef | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Валидатор ядра (ошибки — уровень не загрузится) и линт (предупреждения дизайнеру). */
export function check(raw: Raw): Check {
  try {
    const level = parseLevel(raw);
    return { level, errors: [], warnings: lintLevel(level) };
  } catch (e) {
    if (e instanceof LevelError) return { level: null, errors: e.errors, warnings: [] };
    return { level: null, errors: [String(e)], warnings: [] };
  }
}
