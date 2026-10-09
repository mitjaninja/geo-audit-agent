/** Сводка по базе: npm run report (DB_PATH — путь к sakura.db, по умолчанию data/sakura.db). */
import { resolve } from 'node:path';
import { SqliteStore } from '../src/store.ts';

const path = process.env.DB_PATH ?? resolve(import.meta.dirname, '../../../data/sakura.db');
const store = new SqliteStore(path);
const r = store.report(Date.now());
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(0)}%`);
console.log(`Игроков: ${r.users}`);
console.log(`Воронка: установка ${r.funnel.installs} → уровень 10: ${r.funnel.level10} → уровень 30: ${r.funnel.level30}`);
console.log(`D1: ${r.d1.returned}/${r.d1.cohort} (${pct(r.d1.rate)})`);
console.log('\nуровень  старты  победы  пораж.  win    почти   ходов в запасе');
for (const l of r.levels) {
  console.log(`${String(l.levelId).padEnd(9)}${String(l.starts).padEnd(8)}${String(l.wins).padEnd(8)}${String(l.fails).padEnd(8)}`
    + `${pct(l.winRate).padEnd(7)}${pct(l.nearMissRate).padEnd(8)}${l.avgMovesLeftOnWin.toFixed(1)}`);
}
store.close();
