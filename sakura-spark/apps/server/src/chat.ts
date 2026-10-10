import { ConfigError } from './remote.ts';
import type { BotApi } from './bot.ts';
import { BOT_TEXT } from './bot.ts';
import type { TelegramUser } from './auth.ts';
import { ServiceError } from './service.ts';
import type { GameService, RoomView } from './service.ts';
import type { RoomRow } from './store.ts';

/**
 * Чат-режимы в Telegram (PRD, «Игра в любом чате»): inline-режим и карточки, которые бот редактирует.
 *
 * Ссылка «Играть» из группы не может быть web_app-кнопкой — только URL. Если у бота включён Main Mini App,
 * ссылка t.me/<bot>?startapp=<room> открывает игру сразу; иначе — t.me/<bot>?start=<room>: бот в личке
 * отвечает web_app-кнопкой с той же комнатой. Режим определяется по getMe при старте.
 */
export interface ChatBotDeps {
  readonly api: BotApi;
  readonly service: GameService;
  /** Адрес Mini App (https://…/). */
  readonly webAppUrl: string;
  readonly botUsername: string;
  /** У бота включён Main Mini App — прямые ссылки startapp. */
  readonly directLinks: boolean;
  /** Задержка перед правкой карточки: несколько результатов подряд — одна правка. */
  readonly refreshDelayMs?: number;
  readonly now?: () => number;
  readonly log?: (msg: string) => void;
  /** Telegram id администраторов: им доступны /refund, /config…, /report. */
  readonly adminIds?: readonly number[];
  /** Сводка для /report (есть только с SQLite-хранилищем). */
  readonly report?: () => Promise<string>;
}

interface TgUser { id: number; first_name?: string; username?: string; language_code?: string }
interface SuccessfulPayment { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string }
interface Update {
  message?: { chat: { id: number; type: string }; from?: TgUser; text?: string; successful_payment?: SuccessfulPayment };
  pre_checkout_query?: { id: string; from: TgUser; currency: string; total_amount: number; invoice_payload: string };
  inline_query?: { id: string; from: TgUser; query: string };
  chosen_inline_result?: { result_id: string; from: TgUser; inline_message_id?: string };
  callback_query?: { id: string; from: TgUser; data?: string; inline_message_id?: string };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ');
const MEDALS = ['🥇', '🥈', '🥉', '4.', '5.'];
const toUser = (u: TgUser): TelegramUser => ({
  id: u.id, firstName: u.first_name ?? '',
  ...(u.username ? { username: u.username } : {}), ...(u.language_code ? { languageCode: u.language_code } : {}),
});

export const CHAT_TEXT = {
  challengeTitle: 'Челлендж чата',
  challengeDescription: (level: number) => `Уровень ${level} · кто наберёт больше очков за 24 часа`,
  helpTitle: 'Попросить жизнь',
  helpDescription: 'Друзья в чате подарят фонарики-сердечки',
  play: '🌸 Играть',
  top: '🏆 Рейтинг',
  gift: '❤ Подарить жизнь',
  playGame: '🌸 Играть в Sakura Spark',
  limitTitle: 'На сегодня хватит карточек',
  limitText: 'Можно отправить 5 карточек в день — завтра будут новые 🌸',
  roomStart: (creator: string, level: number) =>
    `${creator} зовёт в челлендж чата: уровень ${level}. У всех одна и та же раскладка — кто наберёт больше очков? Первая попытка бесплатно.`,
  roomGone: 'Эта комната уже закрыта. Но играть можно всегда 🌸',
  giftResult: {
    ok: 'Жизнь отправлена! ❤',
    already: 'Ты уже дарил жизнь по этой просьбе',
    full: 'Уже подарили 5 жизней — спасибо!',
    own: 'Себе подарить нельзя 🙂',
    expired: 'Просьба устарела',
    not_found: 'Карточка не найдена',
  },
  refreshed: 'Рейтинг обновлён',
} as const;

export class ChatBot {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: ChatBotDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  /** Ссылка «Играть» для карточки в чате. */
  link(roomId?: string): string {
    const payload = roomId ?? 'play';
    return `https://t.me/${this.deps.botUsername}?${this.deps.directLinks ? 'startapp' : 'start'}=${payload}`;
  }

  cardText(room: RoomRow, view: RoomView): string {
    if (room.mode === 'help') {
      const name = esc(room.creatorName || 'Игрок');
      return `🏮 <b>${name} просит жизнь!</b>\nФонарики-сердечки закончились. Нажми кнопку — и жизнь улетит к ${name}.\n\nПодарили: ${view.gifts}/${view.maxGifts}`;
    }
    const lines = view.top.length > 0
      ? view.top.map((r, i) => `${MEDALS[i]} ${esc(r.name || 'Игрок')} — ${fmt(r.score)}${r.boosted ? ' ⚡' : ''}`).join('\n')
      : 'Пока никто не сыграл — будь первым!';
    const hoursLeft = Math.max(0, Math.ceil((room.expiresAt - this.now()) / 3600_000));
    const footer = view.expired ? 'Челлендж завершён 🏁' : `Сыграли: ${view.players} · до конца ${hoursLeft} ч`;
    const legend = view.top.some((r) => r.boosted) ? '\n⚡ — с бустерами' : '';
    return `🌸 <b>${CHAT_TEXT.challengeTitle}</b> · уровень ${room.levelId}\n${esc(room.creatorName || 'Игрок')} зовёт: кто наберёт больше очков? Первая попытка бесплатно.\n\n${lines}${legend}\n\n${footer}`;
  }

  cardMarkup(room: RoomRow): { inline_keyboard: unknown[][] } {
    return room.mode === 'help'
      ? { inline_keyboard: [[{ text: CHAT_TEXT.gift, callback_data: `gift:${room.id}` }], [{ text: CHAT_TEXT.playGame, url: this.link() }]] }
      : { inline_keyboard: [[{ text: CHAT_TEXT.play, url: this.link(room.id) }], [{ text: CHAT_TEXT.top, callback_data: `top:${room.id}` }]] };
  }

  private async article(room: RoomRow): Promise<Record<string, unknown>> {
    const view = await this.deps.service.roomView(room.id, null);
    return {
      type: 'article',
      id: room.id,
      title: room.mode === 'help' ? CHAT_TEXT.helpTitle : CHAT_TEXT.challengeTitle,
      description: room.mode === 'help' ? CHAT_TEXT.helpDescription : CHAT_TEXT.challengeDescription(room.levelId),
      input_message_content: { message_text: this.cardText(room, view), parse_mode: 'HTML' },
      reply_markup: this.cardMarkup(room),
    };
  }

  /** Карточка для shareMessage из Mini App (savePreparedInlineMessage, Bot API 8.0). */
  async prepare(room: RoomRow, userId: number): Promise<string> {
    const r = await this.deps.api.call<{ id: string }>('savePreparedInlineMessage', {
      user_id: userId, result: await this.article(room),
      allow_user_chats: true, allow_group_chats: true, allow_channel_chats: false, allow_bot_chats: false,
    });
    return r.id;
  }

  /** Обновить карточку в чате (рейтинг или подарки) — с задержкой, чтобы серия результатов дала одну правку. */
  scheduleRefresh(roomId: string): void {
    const delay = this.deps.refreshDelayMs ?? 2000;
    if (this.timers.has(roomId)) return;
    this.timers.set(roomId, setTimeout(() => {
      this.timers.delete(roomId);
      this.refresh(roomId).catch((e) => this.log(`card refresh ${roomId}: ${String(e)}`));
    }, delay));
  }

  async refresh(roomId: string): Promise<boolean> {
    const room = await this.deps.service.getRoom(roomId);
    if (!room?.inlineMessageId) return false;
    const view = await this.deps.service.roomView(roomId, null);
    try {
      await this.deps.api.call('editMessageText', {
        inline_message_id: room.inlineMessageId, text: this.cardText(room, view), parse_mode: 'HTML',
        reply_markup: this.cardMarkup(room),
      });
    } catch (e) {
      // карточка не изменилась — это не ошибка
      if (!/message is not modified/.test(String(e))) throw e;
    }
    return true;
  }

  async handleUpdate(raw: unknown): Promise<void> {
    const u = raw as Update;
    if (u.pre_checkout_query) return this.onPreCheckout(u.pre_checkout_query);
    if (u.message?.successful_payment) return this.onPaid(u.message);
    if (u.message) return this.onMessage(u.message);
    if (u.inline_query) return this.onInlineQuery(u.inline_query);
    if (u.chosen_inline_result) return this.onChosen(u.chosen_inline_result);
    if (u.callback_query) return this.onCallback(u.callback_query);
  }

  /** Ссылка на оплату счёта в Telegram Stars (валюта XTR, provider_token не нужен). */
  async invoiceLink(inv: { invoiceId: string; title: string; description: string; stars: number }): Promise<string> {
    return this.deps.api.call<string>('createInvoiceLink', {
      title: inv.title, description: inv.description, payload: inv.invoiceId, currency: 'XTR',
      prices: [{ label: inv.title, amount: inv.stars }],
    });
  }

  /** Telegram ждёт ответ за 10 секунд: только сверка счёта, без тяжёлой работы. */
  private async onPreCheckout(q: NonNullable<Update['pre_checkout_query']>): Promise<void> {
    const error = await this.deps.service.preCheckout(q.invoice_payload, q.from.id, q.currency, q.total_amount);
    await this.deps.api.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id, ok: error === null, ...(error ? { error_message: error } : {}),
    });
  }

  private async onPaid(msg: NonNullable<Update['message']>): Promise<void> {
    const p = msg.successful_payment!;
    if (!msg.from) return;
    const status = await this.deps.service.completePayment(p.telegram_payment_charge_id, p.invoice_payload, msg.from.id, p.total_amount);
    if (status === 'unknown') this.log(`payment for unknown invoice ${p.invoice_payload} (${p.telegram_payment_charge_id})`);
    if (status === 'ok') await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: BOT_TEXT.paid('Покупка') });
  }

  /** /refund <charge id> — только администраторам: сначала возврат в Telegram, потом списание в игре. */
  private async onRefund(chatId: number, fromId: number | undefined, chargeId: string | undefined): Promise<void> {
    if (!fromId || !this.deps.adminIds?.includes(fromId)) return;
    const reply = (text: string) => this.deps.api.call('sendMessage', { chat_id: chatId, text });
    if (!chargeId) return void (await reply('Использование: /refund <telegram_payment_charge_id>'));
    const pay = await this.deps.service.getPayment(chargeId);
    if (!pay) return void (await reply('Платёж не найден'));
    if (pay.refunded) return void (await reply('Уже возвращён'));
    try {
      await this.deps.api.call('refundStarPayment', { user_id: pay.userId, telegram_payment_charge_id: chargeId });
    } catch (e) {
      return void (await reply(`Telegram не вернул платёж: ${String(e)}`));
    }
    await this.deps.service.refund(chargeId);
    await reply(`Возвращено ${pay.stars} ⭐ игроку ${pay.userId}, покупка «${pay.product}» списана`);
  }

  /**
   * Remote config из чата с ботом (только администраторы):
   * /config — действующий конфиг и история; /config_set <JSON> — заменить целиком; /config_rollback — откат.
   */
  private async onConfig(chatId: number, fromId: number | undefined, cmd: string, arg: string): Promise<void> {
    if (!fromId || !this.deps.adminIds?.includes(fromId)) return;
    const reply = (text: string) => this.deps.api.call('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });
    const svc = this.deps.service;
    if (cmd === 'config_set') {
      if (!arg.trim()) return void (await reply('Использование: /config_set {"economy":{"refillLives":10}}\nПустой конфиг — /config_set {}'));
      try {
        const { id, config } = await svc.setConfig(arg, fromId);
        const exps = (config.experiments ?? []).map((e) => `${e.id}${e.active ? '' : ' (выкл.)'}: ${e.variants.map((v) => `${v.name} ${v.weight}`).join(' / ')}`);
        await reply(`Конфиг #${id} сохранён и действует сразу.${exps.length ? `\nЭксперименты:\n${exps.join('\n')}` : ''}`);
      } catch (e) {
        if (e instanceof ConfigError) return void (await reply(`Не сохранил: ${e.message}`));
        throw e;
      }
      return;
    }
    if (cmd === 'config_rollback') {
      const r = await svc.rollbackConfig(fromId);
      return void (await reply(r ? `Вернул версию #${r.from}, теперь это #${r.id}` : 'Откатывать некуда: версий меньше двух'));
    }
    const history = await svc.configHistory(5);
    const current = history[0];
    if (!current) return void (await reply('Конфиг пустой — действуют значения по умолчанию.\nПример: /config_set {"economy":{"refillLives":10}}'));
    const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    await reply([
      `Конфиг #${current.id} от ${when(current.createdAt)} UTC:`,
      JSON.stringify(JSON.parse(current.json), null, 1),
      '',
      `История: ${history.map((h) => `#${h.id} ${when(h.createdAt)}`).join(', ')}`,
    ].join('\n'));
  }

  private async onMessage(msg: NonNullable<Update['message']>): Promise<void> {
    if (!msg.text || msg.chat.type !== 'private') return;
    if (/^\/report(?:@\w+)?$/.test(msg.text) && msg.from && this.deps.adminIds?.includes(msg.from.id) && this.deps.report) {
      const text = await this.deps.report();
      // сообщение Telegram — до 4096 символов: длинную сводку режем на части по строкам
      const parts: string[] = [];
      for (const line of text.split('\n')) {
        if (parts.length === 0 || parts.at(-1)!.length + line.length + 1 > 3900) parts.push(line);
        else parts[parts.length - 1] += `\n${line}`;
      }
      for (const p of parts) await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: p });
      return;
    }
    const conf = /^\/(config|config_set|config_rollback)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(msg.text);
    if (conf) return this.onConfig(msg.chat.id, msg.from?.id, conf[1]!, conf[2] ?? '');
    if (/^\/myid(?:@\w+)?$/.test(msg.text)) {
      return void (await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: `Твой Telegram id: ${msg.from?.id ?? '—'}` }));
    }
    const cmd = /^\/(paysupport|terms|refund)(?:@\w+)?(?:\s+(\S+))?/.exec(msg.text);
    if (cmd?.[1] === 'refund') return this.onRefund(msg.chat.id, msg.from?.id, cmd[2]);
    if (cmd) return void (await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: cmd[1] === 'terms' ? BOT_TEXT.terms : BOT_TEXT.paysupport }));
    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(msg.text);
    if (!m) return;
    const payload = m[1];
    const room = payload?.startsWith('r') ? await this.deps.service.getRoom(payload) : null;
    if (room && room.mode === 'challenge') {
      const url = `${this.deps.webAppUrl}?room=${encodeURIComponent(room.id)}`;
      await this.deps.api.call('sendMessage', {
        chat_id: msg.chat.id, text: CHAT_TEXT.roomStart(room.creatorName || 'Друг', room.levelId),
        reply_markup: { inline_keyboard: [[{ text: CHAT_TEXT.play, web_app: { url } }]] },
      });
      return;
    }
    await this.deps.api.call('sendMessage', {
      chat_id: msg.chat.id,
      text: payload?.startsWith('r') ? CHAT_TEXT.roomGone : BOT_TEXT.start(msg.from?.first_name ?? 'путник'),
      reply_markup: { inline_keyboard: [[{ text: BOT_TEXT.play, web_app: { url: this.deps.webAppUrl } }]] },
    });
  }

  /** Inline-режим: карточки челленджа и просьбы о жизни. Комнаты создаются под каждый запрос. */
  private async onInlineQuery(q: NonNullable<Update['inline_query']>): Promise<void> {
    const user = await this.deps.service.login(toUser(q.from));
    let results: Record<string, unknown>[];
    try {
      const challenge = await this.deps.service.createRoom(user.id, 'challenge');
      const help = await this.deps.service.createRoom(user.id, 'help');
      results = [await this.article(challenge), await this.article(help)];
    } catch (e) {
      if (!(e instanceof ServiceError && e.code === 'room_limit')) throw e;
      results = [{
        type: 'article', id: 'limit', title: CHAT_TEXT.limitTitle, description: CHAT_TEXT.limitText,
        input_message_content: { message_text: CHAT_TEXT.limitText },
        reply_markup: { inline_keyboard: [[{ text: CHAT_TEXT.playGame, url: this.link() }]] },
      }];
    }
    await this.deps.api.call('answerInlineQuery', { inline_query_id: q.id, results, cache_time: 0, is_personal: true });
  }

  /** Карточку отправили (нужен inline feedback в BotFather) — запоминаем её, чтобы редактировать. */
  private async onChosen(c: NonNullable<Update['chosen_inline_result']>): Promise<void> {
    if (!c.inline_message_id || !c.result_id.startsWith('r')) return;
    await this.deps.service.setRoomMessage(c.result_id, c.inline_message_id);
  }

  private async onCallback(c: NonNullable<Update['callback_query']>): Promise<void> {
    const [kind, roomId] = (c.data ?? '').split(':');
    if (!roomId) return void (await this.deps.api.call('answerCallbackQuery', { callback_query_id: c.id }));
    // без inline feedback id карточки приходит с первым нажатием кнопки в ней
    if (c.inline_message_id) await this.deps.service.setRoomMessage(roomId, c.inline_message_id);
    if (kind === 'gift') {
      const r = await this.deps.service.giftLife(roomId, toUser(c.from));
      await this.deps.api.call('answerCallbackQuery', { callback_query_id: c.id, text: CHAT_TEXT.giftResult[r.status] });
      if (r.status === 'ok' || r.status === 'full') await this.refresh(roomId);
      return;
    }
    await this.refresh(roomId);
    await this.deps.api.call('answerCallbackQuery', { callback_query_id: c.id, text: CHAT_TEXT.refreshed });
  }
}
