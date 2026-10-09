import { resolve } from 'node:path';

export interface Config {
  readonly port: number;
  readonly botToken: string;
  /** Публичный HTTPS-адрес сервера: на нём и Mini App, и вебхук. */
  readonly publicUrl: string;
  readonly webhookSecret: string;
  readonly dbPath: string;
  readonly levelsDir: string;
  /** Собранный клиент; сервер раздаёт его сам, чтобы хватило одного HTTPS-хоста. */
  readonly clientDir: string;
  /** Вход «Authorization: dev <id>» без Telegram — только для локальной разработки. */
  readonly devAuth: boolean;
}

const root = resolve(import.meta.dirname, '../../..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const devAuth = env.DEV_AUTH === '1';
  const botToken = env.BOT_TOKEN ?? '';
  if (!botToken && !devAuth) throw new Error('BOT_TOKEN is required (or DEV_AUTH=1 for local development)');
  return {
    port: Number(env.PORT ?? 8787),
    botToken,
    // на Fly.io адрес приложения известен по его имени
    publicUrl: env.PUBLIC_URL
      ?? (env.FLY_APP_NAME ? `https://${env.FLY_APP_NAME}.fly.dev` : `http://localhost:${env.PORT ?? 8787}`),
    webhookSecret: env.WEBHOOK_SECRET ?? '',
    dbPath: env.DB_PATH ?? resolve(root, 'data/sakura.db'),
    levelsDir: env.LEVELS_DIR ?? resolve(root, 'levels'),
    clientDir: env.CLIENT_DIR ?? resolve(root, 'apps/client/dist'),
    devAuth,
  };
}
