import type { LevelDef } from '@sakura/core';
import { playOnce } from './autotest.ts';
import type { BotName } from './bots.ts';
import { targetBand } from './targets.ts';

export interface TuneOptions {
  readonly bot: BotName;
  readonly runs: number;
  readonly minMoves: number;
  readonly maxMoves: number;
  readonly seedBase?: number;
}

export interface TuneResult {
  readonly moves: number;
  readonly winRate: number;
  readonly stars: [number, number, number];
  /** Попал ли win rate в коридор PRD хоть при каком-то числе ходов в допустимом диапазоне. */
  readonly inBand: boolean;
}

/**
 * Подбор числа ходов: win rate растёт с ходами, ищем бинарным поиском значение,
 * ближайшее к центру коридора. winRateAt — чистая функция (в тестах — подставная).
 */
/**
 * Куда целиться внутри коридора: в центр, а у ранних уровней (коридор до 100%) — в 97%.
 * Иначе тюнер урезает ходы до минимума и первые уровни становятся короткой гонкой,
 * а PRD хочет, чтобы они проходились «почти без поражений».
 */
export function targetRate(band: { min: number; max: number }): number {
  return band.max >= 1 ? 0.97 : (band.min + band.max) / 2;
}

export function searchMoves(
  winRateAt: (moves: number) => number, band: { min: number; max: number }, lo: number, hi: number,
): { moves: number; winRate: number } {
  const target = targetRate(band);
  const cache = new Map<number, number>();
  const at = (m: number) => {
    if (!cache.has(m)) cache.set(m, winRateAt(m));
    return cache.get(m)!;
  };
  let a = lo;
  let b = hi;
  while (b - a > 1) {
    const mid = Math.floor((a + b) / 2);
    if (at(mid) < target) a = mid;
    else b = mid;
  }
  // из двух соседей — тот, что ближе к центру коридора; при равенстве — больше ходов (мягче к игроку)
  const best = Math.abs(at(a) - target) < Math.abs(at(b) - target) ? a : b;
  return { moves: best, winRate: at(best) };
}

const roundTo = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);

/**
 * Пороги звёзд по счетам побед: 1★ — цель по очкам (если есть) или ниже медианы,
 * 2★ — медиана, 3★ — 85-й перцентиль. Победа и так даёт минимум одну звезду.
 */
export function starThresholds(winScores: number[], scoreTarget?: number): [number, number, number] {
  const sorted = [...winScores].sort((x, y) => x - y);
  const q = (p: number) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const s2 = roundTo(Math.max(q(0.5), (scoreTarget ?? 0) * 1.3), 100);
  const s3 = Math.max(roundTo(q(0.85), 100), s2 + 500);
  const s1 = scoreTarget ?? roundTo(Math.min(q(0.15), s2 * 0.6), 100);
  return [Math.min(s1, s2 - 100), s2, s3];
}

export function tuneLevel(level: LevelDef, opts: TuneOptions): TuneResult {
  const band = targetBand(level);
  const seedBase = opts.seedBase ?? 50_000;
  const rate = (moves: number) => {
    let wins = 0;
    for (let i = 0; i < opts.runs; i++) if (playOnce({ ...level, moves }, seedBase + i, opts.bot).status === 'won') wins++;
    return wins / opts.runs;
  };
  const { moves, winRate } = searchMoves(rate, band, opts.minMoves, opts.maxMoves);
  const scores: number[] = [];
  for (let i = 0; i < opts.runs; i++) {
    const g = playOnce({ ...level, moves }, seedBase + 10_000 + i, opts.bot);
    if (g.status === 'won') scores.push(g.score);
  }
  const scoreGoal = level.goals.find((g) => g.type === 'score');
  return {
    moves, winRate,
    stars: starThresholds(scores, scoreGoal?.type === 'score' ? scoreGoal.target : undefined),
    inBand: winRate >= band.min - 0.05 && winRate <= band.max + 0.05,
  };
}

/** JSON уровня в читаемом виде: сетки — строка на ряд, мелкие объекты — в одну строку. */
export function formatLevel(level: object): string {
  const inline = (v: unknown) => JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }');
  const lines = Object.entries(level).map(([k, v]) => {
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      return `  "${k}": [\n${v.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`;
    }
    if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return `  "${k}": ${JSON.stringify(v).replace(/,/g, ', ')}`;
    if (Array.isArray(v)) return `  "${k}": [\n${v.map((x) => `    ${inline(x)}`).join(',\n')}\n  ]`;
    if (v && typeof v === 'object') return `  "${k}": ${inline(v)}`;
    return `  "${k}": ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}
