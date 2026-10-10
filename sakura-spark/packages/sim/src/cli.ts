import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseLevel } from '@sakura/core';
import { autotestLevel, formatReports } from './autotest.ts';
import { BOT_NAMES } from './bots.ts';
import { defaultWorkers, runJobs } from './pool.ts';
import type { BotName } from './bots.ts';

const HELP = `Автотест уровней: прогоняет бота по сидам и сравнивает win rate с целями PRD.

npm run autotest -- [файлы.json…] [--runs 1000] [--bot greedy|random|casual] [--seed 0] [--assist 0.04] [--json out.json] [--strict] [--workers N]

Без файлов берёт все уровни из levels/. --strict: код выхода 1, если уровень вне целевого коридора.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '1000' },
    bot: { type: 'string', default: 'greedy' },
    seed: { type: 'string', default: '0' },
    assist: { type: 'string' },
    json: { type: 'string' },
    strict: { type: 'boolean', default: false },
    workers: { type: 'string', default: String(defaultWorkers()) },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (!(BOT_NAMES as readonly string[]).includes(values.bot)) throw new Error(`unknown bot ${values.bot}; use ${BOT_NAMES.join(', ')}`);

// npm запускает скрипт из packages/sim; пути пользователя — относительно INIT_CWD
const cwd = process.env.INIT_CWD ?? process.cwd();
const levelsDir = resolve(import.meta.dirname, '../../../levels');
const files = positionals.length > 0
  ? positionals.map((f) => resolve(cwd, f))
  : readdirSync(levelsDir).filter((f) => f.endsWith('.json')).sort().map((f) => join(levelsDir, f));

const options = {
  runs: Number(values.runs), bot: values.bot as BotName, seedBase: Number(values.seed),
  ...(values.assist ? { assist: Number(values.assist) } : {}),
};
const levels = files.map((file) => parseLevel(JSON.parse(readFileSync(file, 'utf8'))));
const workers = Number(values.workers);
const reports = workers > 1
  ? await runJobs(levels.map((level) => ({ kind: 'autotest' as const, level, options })), workers,
    (_, r) => process.stderr.write(`level ${r.levelId}: ${(r.winRate * 100).toFixed(0)}%\n`))
  : levels.map((level) => {
    const report = autotestLevel(level, options);
    process.stderr.write(`level ${level.id}: ${(report.winRate * 100).toFixed(0)}%\n`);
    return report;
  });

console.log(formatReports(reports));
if (values.json) writeFileSync(resolve(cwd, values.json), JSON.stringify(reports, null, 2));
if (values.strict && reports.some((r) => r.verdict !== 'ok')) process.exit(1);
