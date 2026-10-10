/**
 * Калибровка казуального бота по реальным данным (ROADMAP, этап 13).
 *
 * Уровни настроены ботом с допущениями CASUAL_SKILL = 0.5 и 3,6 с на ход. Когда пойдут живые игроки,
 * `npm run report -- --json` даёт win rate «чистых» партий (без бустеров, облегчения и докупки ходов).
 * Подбираем skill, при котором бот проходит уровни так же часто, как люди, — сначала по уровням без
 * таймера, потом темп по уровням со временем. С подобранной моделью тюнер даёт честные новые уровни.
 */
import type { LevelDef } from '@sakura/core';
import { autotestLevel } from './autotest.ts';
import type { PlayerModel } from './autotest.ts';

export interface RealLevelStats {
  readonly levelId: number;
  readonly games: number;
  readonly winRate: number;
}

export interface CalibrationRow {
  readonly levelId: number;
  readonly games: number;
  readonly real: number;
  readonly bot: number;
}

export interface Calibration {
  readonly skill: number;
  /** null — данных по уровням со временем мало, темп не подбирался. */
  readonly secondsPerMove: number | null;
  /** Средневзвешенное (по числу партий) квадратичное отклонение win rate. */
  readonly error: number;
  readonly rows: readonly CalibrationRow[];
  readonly skipped: readonly number[];
}

export interface CalibrateOptions {
  readonly runs: number;
  readonly minGames?: number;
  readonly skills?: readonly number[];
  readonly secondsPerMove?: readonly number[];
  readonly onProgress?: (msg: string) => void;
}

const grid = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(Math.round(x * 100) / 100);
  return out;
};
export const DEFAULT_SKILLS = grid(0.1, 0.9, 0.05);
export const DEFAULT_PACES = grid(2.4, 6, 0.3);

function fit(levels: readonly { level: LevelDef; real: RealLevelStats }[], runs: number, model: PlayerModel) {
  let err = 0;
  let weight = 0;
  const rows = levels.map(({ level, real }) => {
    const bot = autotestLevel(level, { runs, bot: 'casual', model }).winRate;
    err += real.games * (bot - real.winRate) ** 2;
    weight += real.games;
    return { levelId: level.id, games: real.games, real: real.winRate, bot };
  });
  return { error: weight > 0 ? err / weight : 0, rows };
}

export function calibrate(levels: ReadonlyMap<number, LevelDef>, real: readonly RealLevelStats[], opts: CalibrateOptions): Calibration {
  const { runs, minGames = 30, skills = DEFAULT_SKILLS, secondsPerMove = DEFAULT_PACES, onProgress = () => {} } = opts;
  const usable = real.filter((r) => r.games >= minGames && levels.has(r.levelId)).map((r) => ({ level: levels.get(r.levelId)!, real: r }));
  const skipped = real.filter((r) => !usable.some((u) => u.real === r)).map((r) => r.levelId);
  const moves = usable.filter((u) => u.level.timeLimit === undefined);
  const timed = usable.filter((u) => u.level.timeLimit !== undefined);
  if (moves.length === 0) throw new Error(`нет уровней без таймера с ${minGames}+ чистыми партиями`);

  let best = { skill: skills[0]!, ...fit(moves, runs, { skill: skills[0]! }) };
  for (const skill of skills.slice(1)) {
    const f = fit(moves, runs, { skill });
    onProgress(`skill ${skill}: error ${f.error.toFixed(4)}`);
    if (f.error < best.error) best = { skill, ...f };
  }
  let pace: { secondsPerMove: number; error: number; rows: CalibrationRow[] } | null = null;
  for (const spm of timed.length > 0 ? secondsPerMove : []) {
    const f = fit(timed, runs, { skill: best.skill, secondsPerMove: spm });
    onProgress(`${spm} s/move: error ${f.error.toFixed(4)}`);
    if (!pace || f.error < pace.error) pace = { secondsPerMove: spm, ...f };
  }
  const rows = [...best.rows, ...(pace?.rows ?? [])].sort((a, b) => a.levelId - b.levelId);
  const total = rows.reduce((s, r) => s + r.games, 0);
  return {
    skill: best.skill, secondsPerMove: pace?.secondsPerMove ?? null,
    error: rows.reduce((s, r) => s + r.games * (r.bot - r.real) ** 2, 0) / total,
    rows, skipped,
  };
}
