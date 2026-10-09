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
  start: (name: string) =>
    `Привет, ${name}! 🌸\n\nКурогири украл фестивальные фонари, и сакура в Хоширо перестала цвести. ` +
    'Помоги Мике вернуть свет — собирай кристаллы по три и больше.',
  play: 'Играть',
} as const;

interface Update {
  message?: { chat: { id: number; type: string }; from?: { first_name?: string }; text?: string };
}

/**
 * Обработка апдейта. Сейчас только /start в личке: приветствие и кнопка web_app.
 * Inline-режим и карточки для чатов — этап 9.
 */
export async function handleUpdate(update: unknown, api: BotApi, webAppUrl: string): Promise<void> {
  const msg = (update as Update).message;
  if (!msg?.text || msg.chat.type !== 'private') return;
  if (!/^\/start(\s|$|@)/.test(msg.text)) return;
  await api.call('sendMessage', {
    chat_id: msg.chat.id,
    text: BOT_TEXT.start(msg.from?.first_name ?? 'путник'),
    reply_markup: { inline_keyboard: [[{ text: BOT_TEXT.play, web_app: { url: webAppUrl } }]] },
  });
}

/** Настройка бота: вебхук с секретом и кнопка меню, открывающая игру. */
export async function setupBot(api: BotApi, publicUrl: string, webhookSecret: string): Promise<void> {
  const base = publicUrl.replace(/\/$/, '');
  await api.call('setWebhook', {
    url: `${base}/telegram/webhook`,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'inline_query', 'chosen_inline_result', 'callback_query'],
    drop_pending_updates: true,
  });
  await api.call('setChatMenuButton', { menu_button: { type: 'web_app', text: BOT_TEXT.play, web_app: { url: `${base}/` } } });
}
