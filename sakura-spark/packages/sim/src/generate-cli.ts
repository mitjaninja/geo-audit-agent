/**
 * Контент: черновики уровней генератором → ходы и звёзды под коридор PRD казуальным ботом → проверка
 * 1 000 прогонами. Всё в несколько потоков.
 *
 * npm run generate -- --from 31 --to 200 [--runs 80] [--check 400] [--rounds 3] [--workers N] [--force]
 *
 * Уже существующие файлы не генерирует заново без --force (уровни, поправленные руками, не перезапишутся),
 * но проверяет и подправляет ходы всех уровней диапазона. Партия казуального бота на поле 9×9 — 0,1–0,2 с,
 * поэтому проверка — 400 прогонов (±5%); полный автотест на 1 000 — `npm run autotest -- --runs 1000`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { lintLevel, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { playOnce } from './autotest.ts';
import { generateLevel } from './generate.ts';
import { defaultWorkers, runJobs } from './pool.ts';
import { targetBand } from './targets.ts';
import { formatLevel, starThresholds, targetRate } from './tune.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '31' },
    to: { type: 'string', default: '200' },
    runs: { type: 'string', default: '80' },
    check: { type: 'string', default: '400' },
    rounds: { type: 'string', default: '3' },
    workers: { type: 'string', default: String(defaultWorkers()) },
    force: { type: 'boolean', default: false },
  },
});
const dir = resolve(import.meta.dirname, '../../../levels');
const file = (id: number) => join(dir, `${String(id).padStart(4, '0')}.json`);
const workers = Number(values.workers);
const runs = Number(values.runs);
const ids: number[] = [];
for (let id = Number(values.from); id <= Number(values.to); id++) if (values.force || !existsSync(file(id))) ids.push(id);
console.log(`levels to make: ${ids.length}`);

const drafts = new Map(ids.map((id) => [id, generateLevel(id) as unknown as Record<string, unknown>]));
const write = (id: number, raw: Record<string, unknown>) => {
  writeFileSync(file(id), formatLevel(raw));
  const level = parseLevel(JSON.parse(readFileSync(file(id), 'utf8')));
  const lint = lintLevel(level);
  if (lint.length > 0) throw new Error(`level ${id}: ${lint.join('; ')}`);
};

// 1. Уровни на ходы: бинарный поиск ходов (tune) в потоках
const moveIds = ids.filter((id) => drafts.get(id)!.timeLimit === undefined);
const t0 = Date.now();
await runJobs(moveIds.map((id) => ({
  kind: 'tune' as const, level: parseLevel(drafts.get(id)!),
  options: { bot: 'casual' as const, runs, minMoves: 12, maxMoves: 60 },
})), workers, (i, r) => {
  const id = moveIds[i]!;
  write(id, { ...drafts.get(id)!, moves: r.moves, stars: r.stars });
  console.log(`tune ${id}: ${r.moves} moves, win ${(r.winRate * 100).toFixed(0)}%${r.inBand ? '' : ' OUT OF BAND'}`);
});
console.log(`tuned ${moveIds.length} in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);

// 2. Уровни на время: цель по очкам — бинарным поиском (их мало, в основном потоке)
for (const id of ids.filter((x) => drafts.get(x)!.timeLimit !== undefined)) {
  const raw = drafts.get(id)!;
  const level = parseLevel(raw);
  const target = targetRate(targetBand(level));
  const withTarget = (score: number): LevelDef => ({ ...level, goals: [{ type: 'score', target: score }] });
  const rate = (score: number) => {
    let wins = 0;
    for (let i = 0; i < runs; i++) if (playOnce(withTarget(score), 60_000 + i, 'casual').status === 'won') wins++;
    return wins / runs;
  };
  let lo = 1000;
  let hi = 60_000;
  while (hi - lo > 200) {
    const mid = Math.round((lo + hi) / 2 / 100) * 100;
    if (rate(mid) >= target) lo = mid;
    else hi = mid;
  }
  const scores: number[] = [];
  for (let i = 0; i < runs; i++) {
    const g = playOnce(withTarget(lo), 70_000 + i, 'casual');
    if (g.status === 'won') scores.push(g.score);
  }
  write(id, { ...raw, goals: [{ type: 'score', target: lo }], stars: starThresholds(scores, lo) });
  console.log(`timed ${id}: score goal ${lo}, win ${(rate(lo) * 100).toFixed(0)}%`);
}

// 3. Проверка 1 000 прогонами на других сидах; вне коридора — сдвиг ходов (или цели по очкам) на шаг,
//    до 4 раундов; из попробованных вариантов остаётся ближайший к коридору
const check = Number(values.check);
if (check > 0) {
  type Best = { raw: Record<string, unknown>; miss: number; win: number };
  const best = new Map<number, Best>();
  const miss = (win: number, band: { min: number; max: number }) => (win < band.min ? band.min - win : win > band.max ? win - band.max : 0);
  const rounds = Number(values.rounds);
  let round: number[] = [];
  for (let id = Number(values.from); id <= Number(values.to); id++) if (existsSync(file(id))) round.push(id);
  for (let r = 0; r <= rounds && round.length > 0; r++) {
    const levels = round.map((id) => parseLevel(JSON.parse(readFileSync(file(id), 'utf8'))));
    const reports = await runJobs(levels.map((level) => ({ kind: 'autotest' as const, level, options: { runs: check, bot: 'casual' as const } })), workers);
    const next: number[] = [];
    for (const rep of reports) {
      const id = rep.levelId;
      const raw = JSON.parse(readFileSync(file(id), 'utf8')) as Record<string, unknown>;
      const m = miss(rep.winRate, rep.target);
      const prev = best.get(id);
      if (!prev || m < prev.miss) best.set(id, { raw, miss: m, win: rep.winRate });
      if (m === 0 || r === rounds) continue;
      const easier = rep.verdict === 'too_hard';
      if (raw.timeLimit !== undefined) {
        const goal = (raw.goals as { target: number }[])[0]!;
        const target = Math.round((goal.target * (easier ? 0.95 : 1.05)) / 100) * 100;
        write(id, { ...raw, goals: [{ type: 'score', target }] });
      } else {
        write(id, { ...raw, moves: (raw.moves as number) + (easier ? 1 : -1) });
      }
      next.push(id);
    }
    console.log(`check round ${r}: ${reports.length - next.length}/${reports.length} in band`);
    round = next;
  }
  // вернуть лучший вариант каждого уровня
  for (const [id, b] of best) write(id, b.raw);
  const out = [...best].filter(([, b]) => b.miss > 0);
  for (const [id, b] of out) console.log(`out of band ${id}: ${(b.win * 100).toFixed(1)}% (miss ${(b.miss * 100).toFixed(1)} pts)`);
  console.log(`done: ${best.size - out.length}/${best.size} in band, ${out.filter(([, b]) => b.miss <= 0.05).length} more within 5 pts`);
  writeFileSync(resolve(import.meta.dirname, '../generate-report.json'),
    JSON.stringify([...best].map(([id, b]) => ({ id, win: Math.round(b.win * 1000) / 1000, miss: Math.round(b.miss * 1000) / 1000 })), null, 1));
}
