import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BotApi, setupBot, setupProfile } from './bot.ts';
import { ChatBot } from './chat.ts';
import { loadConfig } from './config.ts';
import { createApp } from './http.ts';
import { loadLevels } from './levels.ts';
import { GameService } from './service.ts';
import { SqliteStore } from './store.ts';

const config = loadConfig();
if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const store = new SqliteStore(config.dbPath);
const levels = loadLevels(config.levelsDir);
let chat: ChatBot | null = null;
const service = new GameService({ store, levels, onRoomChanged: (id) => chat?.scheduleRefresh(id) });
const log = (m: string) => console.error(m);
const webAppUrl = `${config.publicUrl.replace(/\/$/, '')}/`;
const botApi = config.botToken ? new BotApi(config.botToken) : null;
if (botApi && config.webhookSecret) {
  // имя бота и включён ли Main Mini App (прямые ссылки startapp) — из getMe
  const me = await botApi.call<{ username: string; has_main_web_app?: boolean }>('getMe', {}).catch((e) => {
    log(`getMe failed: ${String(e)}`);
    return { username: process.env.BOT_USERNAME ?? '', has_main_web_app: false };
  });
  chat = new ChatBot({
    api: botApi, service, webAppUrl, botUsername: me.username, directLinks: me.has_main_web_app === true, log, adminIds: config.adminIds,
  });
  console.log(`bot: @${me.username}, links ${chat.link('rX').includes('startapp') ? 'startapp (Main Mini App)' : 'via /start (Main Mini App is off)'}`);
}
const server = createApp({
  service,
  botToken: config.botToken,
  devAuth: config.devAuth,
  clientDir: config.clientDir,
  ...(chat ? { bot: { chat, secret: config.webhookSecret } } : {}),
  log,
});

server.listen(config.port, () => {
  console.log(`Sakura Spark server on :${config.port} — ${levels.size} levels, db ${config.dbPath}${config.devAuth ? ', DEV_AUTH on' : ''}`);
  // вебхук и кнопка меню ставятся при каждом старте: адрес мог смениться, вызовы идемпотентны
  if (botApi && config.webhookSecret && config.publicUrl.startsWith('https://')) {
    const api = botApi;
    setupProfile(api)
      .then(() => setupBot(api, config.publicUrl, config.webhookSecret))
      .then(() => console.log(`bot: webhook ${config.publicUrl}/telegram/webhook`))
      .catch((e) => console.error(`bot setup failed: ${String(e)}`));
  }
});

const shutdown = () => server.close(() => {
  store.close();
  process.exit(0);
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
