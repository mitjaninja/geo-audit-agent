import { gameOptionsFromLevel, Match3Game } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { makeBot } from './bots.ts';
import type { BotName } from './bots.ts';
import { targetBand } from './targets.ts';
import type { WinRateBand } from './targets.ts';

export interface AutotestOptions {
  readonly runs: number;
  readonly bot: BotName;
  /** Сиды поля: seedBase, seedBase+1, … — прогоны воспроизводимы. */
  readonly seedBase?: number;
  readonly assist?: number;
  readonly model?: PlayerModel;
}

/** Модель живого игрока: доля «умных» ходов казуального бота и темп на уровнях со временем. */
export interface PlayerModel {
  readonly skill?: number;
  readonly secondsPerMove?: number;
}

export type Verdict = 'ok' | 'too_hard' | 'too_easy';

export interface LevelReport {
  readonly levelId: number;
  readonly difficulty: LevelDef['difficulty'];
  readonly bot: BotName;
  readonly runs: number;
  readonly wins: number;
  readonly winRate: number;
  /** 95% доверительный интервал Уилсона. */
  readonly ci95: readonly [number, number];
  readonly target: WinRateBand;
  readonly verdict: Verdict;
  /** Сколько партий кончилось на 0, 1, 2, 3 звёздах. */
  readonly stars: readonly [number, number, number, number];
  readonly avgMovesLeftOnWin: number;
  /**
   * Доля всех прогонов, проигранных при прогрессе целей ≥ 80% — кандидаты на окно «+5 ходов».
   * PRD отдельно отслеживает конверсию этого окна по уровням.
   */
  readonly nearMissRate: number;
  readonly avgMsPerRun: number;
}

export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function goalFraction(game: Match3Game): number {
  const goals = game.goalProgress();
  if (goals.length === 0) return 0;
  return goals.reduce((sum, g) => sum + (g.target > 0 ? Math.min(1, g.current / g.target) : 1), 0) / goals.length;
}

/**
 * Модель времени для уровней на время: живой игрок делает ход примерно раз в 3,6 с с учётом анимаций
 * (90 секунд ≈ 25 ходов). Допущение до данных софт-лонча.
 */
export const SECONDS_PER_MOVE = 3.6;

export function playOnce(level: LevelDef, seed: number, bot: BotName, assist?: number, model: PlayerModel = {}): Match3Game {
  const opts = gameOptionsFromLevel(level, seed);
  const game = new Match3Game(assist ? { ...opts, assist } : opts);
  const choose = makeBot(bot, seed ^ 0x5eed, model.skill);
  const budget = level.timeLimit !== undefined ? Math.round(level.timeLimit / (model.secondsPerMove ?? SECONDS_PER_MOVE)) : Infinity;
  while (game.status === 'playing' && game.history.length < budget) game.swap(choose(game));
  if (game.status === 'playing') game.timeUp();
  return game;
}

export function autotestLevel(level: LevelDef, options: AutotestOptions): LevelReport {
  const { runs, bot, seedBase = 0, assist, model } = options;
  if (!Number.isInteger(runs) || runs < 1) throw new RangeError(`runs ${runs}`);
  let wins = 0;
  let movesLeftOnWin = 0;
  let nearMisses = 0;
  const stars: [number, number, number, number] = [0, 0, 0, 0];
  const started = performance.now();
  for (let i = 0; i < runs; i++) {
    const game = playOnce(level, seedBase + i, bot, assist, model);
    stars[game.stars]++;
    if (game.status === 'won') {
      wins++;
      movesLeftOnWin += game.movesLeft;
    } else if (goalFraction(game) >= 0.8) {
      nearMisses++;
    }
  }
  const winRate = wins / runs;
  const target = targetBand(level);
  const verdict: Verdict = winRate < target.min ? 'too_hard' : winRate > target.max ? 'too_easy' : 'ok';
  return {
    levelId: level.id, difficulty: level.difficulty, bot, runs, wins, winRate,
    ci95: wilson(wins, runs), target, verdict, stars,
    avgMovesLeftOnWin: wins > 0 ? movesLeftOnWin / wins : 0,
    nearMissRate: nearMisses / runs,
    avgMsPerRun: (performance.now() - started) / runs,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function formatReports(reports: readonly LevelReport[]): string {
  const header = ['level', 'diff', 'bot', 'runs', 'win', '95% CI', 'target', 'verdict', 'stars 0/1/2/3', 'moves left', 'near miss', 'ms/run'];
  const rows = reports.map((r) => [
    String(r.levelId), r.difficulty, r.bot, String(r.runs), pct(r.winRate),
    `${pct(r.ci95[0])}–${pct(r.ci95[1])}`, `${pct(r.target.min)}–${pct(r.target.max)}`,
    r.verdict === 'ok' ? 'ok' : r.verdict === 'too_hard' ? 'TOO HARD' : 'TOO EASY',
    r.stars.join('/'), r.avgMovesLeftOnWin.toFixed(1), pct(r.nearMissRate), r.avgMsPerRun.toFixed(1),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
