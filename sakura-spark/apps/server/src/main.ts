import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BotApi } from './bot.ts';
import { loadConfig } from './config.ts';
import { createApp } from './http.ts';
import { loadLevels } from './levels.ts';
import { GameService } from './service.ts';
import { SqliteStore } from './store.ts';

const config = loadConfig();
if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const store = new SqliteStore(config.dbPath);
const levels = loadLevels(config.levelsDir);
const service = new GameService({ store, levels });
const server = createApp({
  service,
  botToken: config.botToken,
  devAuth: config.devAuth,
  clientDir: config.clientDir,
  ...(config.botToken && config.webhookSecret
    ? { bot: { api: new BotApi(config.botToken), webAppUrl: `${config.publicUrl.replace(/\/$/, '')}/`, secret: config.webhookSecret } }
    : {}),
  log: (m) => console.error(m),
});

server.listen(config.port, () => {
  console.log(`Sakura Spark server on :${config.port} — ${levels.size} levels, db ${config.dbPath}${config.devAuth ? ', DEV_AUTH on' : ''}`);
});

const shutdown = () => server.close(() => {
  store.close();
  process.exit(0);
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
