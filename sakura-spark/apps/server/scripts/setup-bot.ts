/**
 * Настройка бота: npm run setup-bot (из корня sakura-spark).
 * Всегда — профиль (описание, команды). С PUBLIC_URL и WEBHOOK_SECRET — ещё вебхук и кнопка меню «Играть».
 */
import { BotApi, setupBot, setupProfile } from '../src/bot.ts';

const { BOT_TOKEN, PUBLIC_URL, WEBHOOK_SECRET } = process.env;
if (!BOT_TOKEN) {
  console.error('Нужен BOT_TOKEN');
  process.exit(1);
}
const api = new BotApi(BOT_TOKEN);
await setupProfile(api);
console.log('Профиль бота обновлён: описание, короткое описание, команда /start');
if (PUBLIC_URL || WEBHOOK_SECRET) {
  if (!PUBLIC_URL?.startsWith('https://') || !WEBHOOK_SECRET) {
    console.error('Для вебхука нужны PUBLIC_URL (https://…) и WEBHOOK_SECRET');
    process.exit(1);
  }
  await setupBot(api, PUBLIC_URL, WEBHOOK_SECRET);
  console.log(`Вебхук: ${PUBLIC_URL}/telegram/webhook, кнопка меню открывает ${PUBLIC_URL}/`);
}
