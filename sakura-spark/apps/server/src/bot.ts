import { createHash } from 'node:crypto';
import { LANGS, TEXTS } from './texts.ts';
import type { Texts } from './texts.ts';

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

/** Тексты бота по умолчанию (русский); остальные языки — TEXTS в texts.ts. */
export const BOT_TEXT = {
  description: TEXTS.ru.bot.description,
  shortDescription: TEXTS.ru.bot.shortDescription,
  commands: commandsFor(TEXTS.ru),
  paysupport: TEXTS.ru.bot.paysupport,
  terms: TEXTS.ru.bot.terms,
  paid: (_what: string) => TEXTS.ru.bot.paid,
  start: TEXTS.ru.bot.start,
  play: TEXTS.ru.bot.play,
} as const;

function commandsFor(tx: Texts): { command: string; description: string }[] {
  return (['start', 'paysupport', 'terms', 'notify'] as const).map((command) => ({ command, description: tx.bot.commands[command] }));
}

/**
 * Токен для заголовка X-Telegram-Bot-Api-Secret-Token. Telegram разрешает в нём только A-Z, a-z, 0-9, _ и -,
 * а хостинги генерируют секреты с + / = — поэтому в Telegram уходит SHA-256 секрета в hex.
 */
export function webhookToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Профиль бота: описание, короткое описание, команды. Не зависит от адреса сервера. */
export async function setupProfile(api: BotApi): Promise<void> {
  // по умолчанию — русский; для en/es/pt Telegram покажет свой вариант по языку пользователя
  for (const lang of LANGS) {
    const tx = TEXTS[lang];
    const code = lang === 'ru' ? {} : { language_code: lang };
    await api.call('setMyDescription', { description: tx.bot.description, ...code });
    await api.call('setMyShortDescription', { short_description: tx.bot.shortDescription, ...code });
    await api.call('setMyCommands', { commands: commandsFor(tx), ...code });
  }
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
