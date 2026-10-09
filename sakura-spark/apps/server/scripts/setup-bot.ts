/** Разовая настройка бота: npm run setup-bot -w @sakura/server (нужны BOT_TOKEN, PUBLIC_URL, WEBHOOK_SECRET). */
import { BotApi, setupBot } from '../src/bot.ts';

const { BOT_TOKEN, PUBLIC_URL, WEBHOOK_SECRET } = process.env;
if (!BOT_TOKEN || !PUBLIC_URL?.startsWith('https://') || !WEBHOOK_SECRET) {
  console.error('Нужны BOT_TOKEN, PUBLIC_URL (https://…) и WEBHOOK_SECRET');
  process.exit(1);
}
await setupBot(new BotApi(BOT_TOKEN), PUBLIC_URL, WEBHOOK_SECRET);
console.log(`Готово: вебхук ${PUBLIC_URL}/telegram/webhook, кнопка меню открывает ${PUBLIC_URL}/`);
