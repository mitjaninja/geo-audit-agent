import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { calibrate } from './calibrate.ts';
import { CASUAL_SKILL } from './bots.ts';
import { SECONDS_PER_MOVE } from './autotest.ts';

const HELP = `Калибровка казуального бота по живым данным.

npm run report -- --json > report.json     (в apps/server, на базе с хостинга)
npm run calibrate -- report.json [--runs 300] [--min-games 30]

Подбирает CASUAL_SKILL и секунды на ход, при которых бот проходит уровни так же часто, как игроки
в «чистых» партиях. Результат переносится в packages/sim/src/bots.ts и autotest.ts руками —
после этого npm run tune настраивает новые уровни уже под настоящих игроков.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '300' },
    'min-games': { type: 'string', default: '30' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (values.help || positionals.length !== 1) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const report = JSON.parse(readFileSync(resolve(cwd, positionals[0]!), 'utf8')) as { levels: { levelId: number; cleanGames: number; cleanWinRate: number }[] };
const levelsDir = resolve(import.meta.dirname, '../../../levels');
const levels = new Map<number, LevelDef>(readdirSync(levelsDir).filter((f) => f.endsWith('.json'))
  .map((f) => parseLevel(JSON.parse(readFileSync(join(levelsDir, f), 'utf8')))).map((l) => [l.id, l]));

const real = report.levels.map((l) => ({ levelId: l.levelId, games: l.cleanGames, winRate: l.cleanWinRate }));
const c = calibrate(levels, real, {
  runs: Number(values.runs), minGames: Number(values['min-games']), onProgress: (m) => process.stderr.write(`${m}\n`),
});
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`CASUAL_SKILL: ${CASUAL_SKILL} → ${c.skill}`);
console.log(`секунд на ход: ${SECONDS_PER_MOVE} → ${c.secondsPerMove ?? 'мало данных по уровням со временем'}`);
console.log(`ошибка: ±${pct(Math.sqrt(c.error))} win rate\n`);
console.log('уровень  партий  игроки  бот');
for (const r of c.rows) console.log(`${String(r.levelId).padEnd(9)}${String(r.games).padEnd(8)}${pct(r.real).padEnd(8)}${pct(r.bot)}`);
if (c.skipped.length > 0) console.log(`\nмало партий: уровни ${c.skipped.join(', ')}`);
