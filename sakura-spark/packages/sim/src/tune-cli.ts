import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseLevel } from '@sakura/core';
import { BOT_NAMES } from './bots.ts';
import type { BotName } from './bots.ts';
import { targetBand } from './targets.ts';
import { formatLevel } from './tune.ts';
import { defaultWorkers, runJobs } from './pool.ts';

const HELP = `Подбор ходов и порогов звёзд под коридор win rate PRD (казуальный бот по умолчанию).

npm run tune -- [файлы.json…] [--runs 150] [--bot casual] [--min 12] [--max 50] [--write] [--workers N]

Без --write только печатает предложения. Уровни на время пропускаются: бот не моделирует скорость игрока.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '150' },
    bot: { type: 'string', default: 'casual' },
    min: { type: 'string', default: '12' },
    max: { type: 'string', default: '50' },
    write: { type: 'boolean', default: false },
    workers: { type: 'string', default: String(defaultWorkers()) },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (!(BOT_NAMES as readonly string[]).includes(values.bot)) throw new Error(`unknown bot ${values.bot}; use ${BOT_NAMES.join(', ')}`);

const cwd = process.env.INIT_CWD ?? process.cwd();
const levelsDir = resolve(import.meta.dirname, '../../../levels');
const files = positionals.length > 0
  ? positionals.map((f) => resolve(cwd, f))
  : readdirSync(levelsDir).filter((f) => f.endsWith('.json')).sort().map((f) => join(levelsDir, f));

const items = files.map((file) => {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  return { file, raw, level: parseLevel(raw) };
});
for (const it of items.filter((x) => x.level.timeLimit !== undefined)) console.log(`level ${it.level.id}: skipped (timed)`);
const todo = items.filter((x) => x.level.timeLimit === undefined);
const options = { bot: values.bot as BotName, runs: Number(values.runs), minMoves: Number(values.min), maxMoves: Number(values.max) };
await runJobs(todo.map((x) => ({ kind: 'tune' as const, level: x.level, options })), Number(values.workers), (i, r) => {
  const { file, raw, level } = todo[i]!;
  const band = targetBand(level);
  console.log(`level ${level.id} [${level.difficulty}]: moves ${level.moves} → ${r.moves}, win ${(r.winRate * 100).toFixed(0)}% `
    + `(target ${band.min * 100}–${band.max * 100}%)${r.inBand ? '' : ' OUT OF BAND'}, stars ${r.stars.join('/')}`);
  if (values.write) {
    writeFileSync(file, formatLevel({ ...raw, moves: r.moves, stars: r.stars }));
    parseLevel(JSON.parse(readFileSync(file, 'utf8')));
  }
});
