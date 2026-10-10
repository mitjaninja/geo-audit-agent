import { createHash } from 'node:crypto';

/** Минимальный клиент Bot API через fetch. fetchImpl подменяется в тестах — сети в тестах нет. */
export class BotApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!body.ok) throw new Error(`Bot API ${method}: ${body.description ?? res.status}`);
    return body.result as T;
  }
}

export const BOT_TEXT = {
  /** Описание в пустом чате с ботом (до 512 символов). */
  description:
    'Sakura Spark — уютная match-3 в аниме-стиле. 🌸\n\n' +
    'Тёмный дух Курогири украл фестивальные фонари Хоширо, и сакура перестала цвести. ' +
    'Собирай светящиеся кристаллы по три и больше, открывай районы города и возвращай свет вместе с Микой и тануки Поном.\n\n' +
    'Играй прямо в Telegram — и зови друзей в чаты.',
  /** Короткое описание в профиле бота (до 120 символов). */
  shortDescription: 'Match-3 в аниме-стиле: собирай кристаллы, зажигай фонари и возвращай весну в Хоширо 🌸',
  commands: [
    { command: 'start', description: 'Играть' },
    { command: 'paysupport', description: 'Помощь с покупками' },
    { command: 'terms', description: 'Условия' },
  ],
  paysupport:
    'Помощь с покупками 🌸\n\nЕсли покупка не зачислилась или что-то пошло не так — напиши сюда, что случилось, '
    + 'и пришли код платежа из чека Telegram. Мы разберёмся и при необходимости вернём Stars.',
  terms:
    'Sakura Spark — бесплатная игра. Кристаллы и бустеры — виртуальные предметы для использования только в игре, '
    + 'они не обмениваются на деньги. Покупки оплачиваются Telegram Stars; по спорным случаям — /paysupport.',
  paid: (what: string) => `Готово! ${what} — уже в игре 🌸`,
  start: (name: string) =>
    `Привет, ${name}! 🌸\n\nКурогири украл фестивальные фонари, и сакура в Хоширо перестала цвести. ` +
    'Помоги Мике вернуть свет — собирай кристаллы по три и больше.',
  play: 'Играть',
} as const;

/**
 * Токен для заголовка X-Telegram-Bot-Api-Secret-Token. Telegram разрешает в нём только A-Z, a-z, 0-9, _ и -,
 * а хостинги генерируют секреты с + / = — поэтому в Telegram уходит SHA-256 секрета в hex.
 */
export function webhookToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Профиль бота: описание, короткое описание, команды. Не зависит от адреса сервера. */
export async function setupProfile(api: BotApi): Promise<void> {
  await api.call('setMyDescription', { description: BOT_TEXT.description });
  await api.call('setMyShortDescription', { short_description: BOT_TEXT.shortDescription });
  await api.call('setMyCommands', { commands: BOT_TEXT.commands });
}

/** Настройка бота: вебхук с секретом и кнопка меню, открывающая игру. */
export async function setupBot(api: BotApi, publicUrl: string, webhookSecret: string): Promise<void> {
  const base = publicUrl.replace(/\/$/, '');
  await api.call('setWebhook', {
    url: `${base}/telegram/webhook`,
    secret_token: webhookToken(webhookSecret),
    allowed_updates: ['message', 'inline_query', 'chosen_inline_result', 'callback_query', 'pre_checkout_query'],
    drop_pending_updates: true,
  });
  await api.call('setChatMenuButton', { menu_button: { type: 'web_app', text: BOT_TEXT.play, web_app: { url: `${base}/` } } });
}
