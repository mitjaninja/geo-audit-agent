/**
 * Сводка по базе: npm run report (DB_PATH — путь к sakura.db, по умолчанию data/sakura.db).
 * npm run report -- --json — то же в JSON: его читает калибровка бота (npm run calibrate в packages/sim).
 * На хостинге то же даёт команда бота /report (администраторам) и GET /api/admin/report.
 */
import { resolve } from 'node:path';
import { parseRemoteConfig } from '../src/remote.ts';
import type { RemoteConfig } from '../src/remote.ts';
import { buildReport, formatReport } from '../src/report.ts';
import { SqliteStore } from '../src/store.ts';

const path = process.env.DB_PATH ?? resolve(import.meta.dirname, '../../../data/sakura.db');
const store = new SqliteStore(path);
const row = await store.getConfig();
let config: RemoteConfig = {};
try {
  config = row ? parseRemoteConfig(JSON.parse(row.json)) : {};
} catch (e) {
  console.error(`remote config #${row?.id}: ${(e as Error).message}`);
}
const r = buildReport(store, config, Date.now());
console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : formatReport(r));
store.close();
