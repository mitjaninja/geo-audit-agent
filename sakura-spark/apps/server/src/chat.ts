import { ConfigError } from './remote.ts';
import type { BotApi } from './bot.ts';
import { TEXTS, textsFor } from './texts.ts';
import type { Texts } from './texts.ts';
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
const MEDALS = ['🥇', '🥈', '🥉', '4.', '5.'];
const toUser = (u: TgUser): TelegramUser => ({
  id: u.id, firstName: u.first_name ?? '',
  ...(u.username ? { username: u.username } : {}), ...(u.language_code ? { languageCode: u.language_code } : {}),
});

/** Тексты карточек по умолчанию (русский); на языке создателя — TEXTS[lang].card. */
export const CHAT_TEXT = TEXTS.ru.card;

export class ChatBot {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: ChatBotDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  /** Ссылка «Играть» для карточки в чате. */
  /** Ссылка в игру: комната, приглашение (fr<id>) или просто игра. */
  link(roomId?: string): string {
    const payload = roomId ?? 'play';
    return `https://t.me/${this.deps.botUsername}?${this.deps.directLinks ? 'startapp' : 'start'}=${payload}`;
  }

  /** Текст карточки на языке tx (карточку видит весь чат — язык её создателя). */
  cardText(room: RoomRow, view: RoomView, tx: Texts = TEXTS.ru): string {
    const c = tx.card;
    const num = (n: number) => n.toLocaleString(tx.locale).replace(/[\u00a0\u202f]/g, ' ');
    const creator = esc(room.creatorName || c.player);
    const hoursLeft = Math.max(0, Math.ceil((room.expiresAt - this.now()) / 3600_000));
    if (room.mode === 'team' && view.team) {
      const { progress, target } = view.team;
      const filled = Math.min(10, Math.floor((progress / Math.max(1, target)) * 10));
      const bar = '🟧'.repeat(filled) + '⬜'.repeat(10 - filled);
      const lines = view.top.length > 0
        ? view.top.map((r, i) => `${MEDALS[i]} ${esc(r.name || c.player)} — ${num(r.score)}`).join('\n')
        : c.teamNobody;
      const footer = progress >= target ? c.teamDone : view.expired ? c.teamFailed : c.members(view.players, hoursLeft);
      return `🏮 <b>${c.teamTitle}</b>\n${c.teamBody(creator)}\n\n${bar}\n${c.teamProgress(Math.min(progress, target), target)}\n\n${lines}\n\n${footer}`;
    }
    if (room.mode === 'duel' && view.duel) {
      const ps = view.duel.players;
      const line = (p: (typeof ps)[number]) => `${esc(p.name || c.player)} — ${p.won ? c.duelMoves(p.moves ?? 0) : c.duelLost(p.score)}`;
      const body = ps.length === 0 ? c.duelWaiting
        : ps.map((p) => `⚔️ ${line(p)}`).join('\n') + (ps.length === 1 && !view.expired ? `\n${c.duelSecond}` : '');
      const footer = view.duel.winner ? c.duelWinner(esc(view.duel.winner)) : view.expired ? c.duelEnded
        : c.minutesLeft(Math.max(1, Math.ceil((room.expiresAt - this.now()) / 60_000)));
      return `⚔️ <b>${c.duelTitle}</b> · ${c.level(room.levelId)}\n${c.duelBody(creator)}\n\n${body}\n\n${footer}`;
    }
    if (room.mode === 'help') return `${c.helpBody(creator)}\n\n${c.gifts(view.gifts, view.maxGifts)}`;
    const lines = view.top.length > 0
      ? view.top.map((r, i) => `${MEDALS[i]} ${esc(r.name || c.player)} — ${num(r.score)}${r.boosted ? ' ⚡' : ''}`).join('\n')
      : c.nobody;
    // турнир идёт час — остаток в минутах; старые суточные комнаты — в часах
    const msLeft = room.expiresAt - this.now();
    const footer = view.expired ? c.challengeEnded
      : msLeft < 2 * 3600_000 ? c.playedMinutes(view.players, Math.max(1, Math.ceil(msLeft / 60_000))) : c.played(view.players, hoursLeft);
    const legend = view.top.some((r) => r.boosted) ? `\n${c.boosted}` : '';
    return `🌸 <b>${c.challengeTitle}</b> · ${c.level(room.levelId)}\n${c.challengeBody(creator)}\n\n${lines}${legend}\n\n${footer}`;
  }

  cardMarkup(room: RoomRow, tx: Texts = TEXTS.ru): { inline_keyboard: unknown[][] } {
    const c = tx.card;
    return room.mode === 'help'
      ? { inline_keyboard: [[{ text: c.gift, callback_data: `gift:${room.id}` }], [{ text: c.playGame, url: this.link() }]] }
      : { inline_keyboard: [[{ text: c.play, url: this.link(room.id) }], [{ text: c.top, callback_data: `top:${room.id}` }]] };
  }

  /** Язык карточки — язык её создателя. */
  private async roomTexts(room: RoomRow): Promise<Texts> {
    return textsFor(await this.deps.service.languageOf(room.creatorId));
  }

  private async article(room: RoomRow): Promise<Record<string, unknown>> {
    const view = await this.deps.service.roomView(room.id, null);
    const tx = await this.roomTexts(room);
    const c = tx.card;
    return {
      type: 'article',
      id: room.id,
      title: { help: c.helpTitle, challenge: c.challengeTitle, team: c.teamTitle, duel: c.duelTitle }[room.mode],
      description: {
        help: c.helpDescription, challenge: c.challengeDescription(room.levelId),
        team: c.teamDescription(room.target), duel: c.duelDescription(room.levelId),
      }[room.mode],
      input_message_content: { message_text: this.cardText(room, view, tx), parse_mode: 'HTML' },
      reply_markup: this.cardMarkup(room, tx),
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
    const tx = await this.roomTexts(room);
    try {
      await this.deps.api.call('editMessageText', {
        inline_message_id: room.inlineMessageId, text: this.cardText(room, view, tx), parse_mode: 'HTML',
        reply_markup: this.cardMarkup(room, tx),
      });
    } catch (e) {
      // карточка не изменилась — это не ошибка
      if (!/message is not modified/.test(String(e))) throw e;
    }
    return true;
  }

  /** Пуш в личку с кнопкой игры. Бот заблокирован — больше не пишем. */
  async push(userId: number, text: string, tx: Texts = TEXTS.ru): Promise<boolean> {
    try {
      await this.deps.api.call('sendMessage', {
        chat_id: userId, text: `${text}\n\n${tx.bot.pushFooter}`,
        reply_markup: { inline_keyboard: [[{ text: tx.bot.play, web_app: { url: this.deps.webAppUrl } }]] },
      });
      return true;
    } catch (e) {
      if (/403|blocked|deactivated|chat not found/i.test(String(e))) await this.deps.service.pushBlocked(userId);
      this.log(`push to ${userId} failed: ${String(e)}`);
      return false;
    }
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
  async invoiceLink(inv: { invoiceId: string; title: string; description: string; stars: number; product?: string }): Promise<string> {
    return this.deps.api.call<string>('createInvoiceLink', {
      title: inv.title, description: inv.description, payload: inv.invoiceId, currency: 'XTR',
      prices: [{ label: inv.title, amount: inv.stars }],
      // пропуск — подписка Stars: Telegram сам списывает раз в 30 дней (subscription_period всегда 2592000)
      ...(inv.product === 'pass' ? { subscription_period: 2_592_000 } : {}),
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
    if (status === 'ok') await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: textsFor(msg.from.language_code).bot.paid });
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
    const tx = textsFor(msg.from?.language_code);
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
    const notify = /^\/notify(?:@\w+)?(?:\s+(on|off))?$/.exec(msg.text);
    if (notify && msg.from) {
      const on = notify[1] !== 'off';
      await this.deps.service.login(toUser(msg.from));
      await this.deps.service.setNotify(msg.from.id, on);
      return void (await this.deps.api.call('sendMessage', {
        chat_id: msg.chat.id, text: on ? tx.bot.notifyOn : tx.bot.notifyOff,
      }));
    }
    if (/^\/myid(?:@\w+)?$/.test(msg.text)) {
      return void (await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: tx.bot.myId(msg.from?.id ?? '—') }));
    }
    const cmd = /^\/(paysupport|terms|refund)(?:@\w+)?(?:\s+(\S+))?/.exec(msg.text);
    if (cmd?.[1] === 'refund') return this.onRefund(msg.chat.id, msg.from?.id, cmd[2]);
    if (cmd) return void (await this.deps.api.call('sendMessage', { chat_id: msg.chat.id, text: cmd[1] === 'terms' ? tx.bot.terms : tx.bot.paysupport }));
    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(msg.text);
    if (!m) return;
    const payload = m[1];
    // приглашение друга: fr<id> — новичок запоминает, кто позвал
    if (payload?.startsWith('fr') && msg.from) await this.deps.service.login(toUser(msg.from), { startParam: payload });
    const room = payload?.startsWith('r') ? await this.deps.service.getRoom(payload) : null;
    if (room && room.mode !== 'help') {
      const url = `${this.deps.webAppUrl}?room=${encodeURIComponent(room.id)}`;
      await this.deps.api.call('sendMessage', {
        chat_id: msg.chat.id,
        text: room.mode === 'team' ? tx.card.teamStart(room.creatorName || tx.bot.friend)
          : room.mode === 'duel' ? tx.card.duelStart(room.creatorName || tx.bot.friend, room.levelId)
            : tx.card.roomStart(room.creatorName || tx.bot.friend, room.levelId),
        reply_markup: { inline_keyboard: [[{ text: tx.card.play, web_app: { url } }]] },
      });
      return;
    }
    await this.deps.api.call('sendMessage', {
      chat_id: msg.chat.id,
      text: payload?.startsWith('r') ? tx.card.roomGone : tx.bot.start(msg.from?.first_name ?? tx.bot.friend),
      reply_markup: { inline_keyboard: [[{ text: tx.bot.play, web_app: { url: this.deps.webAppUrl } }]] },
    });
  }

  /** Inline-режим: карточки турнира и просьбы о жизни. Комнаты создаются под каждый запрос. */
  private async onInlineQuery(q: NonNullable<Update['inline_query']>): Promise<void> {
    const user = await this.deps.service.login(toUser(q.from));
    let results: Record<string, unknown>[];
    try {
      results = [];
      for (const mode of ['challenge', 'help'] as const) results.push(await this.article(await this.deps.service.createRoom(user.id, mode)));
    } catch (e) {
      if (!(e instanceof ServiceError && e.code === 'room_limit')) throw e;
      results = [{
        type: 'article', id: 'limit', title: textsFor(q.from.language_code).card.limitTitle, description: textsFor(q.from.language_code).card.limitText,
        input_message_content: { message_text: textsFor(q.from.language_code).card.limitText },
        reply_markup: { inline_keyboard: [[{ text: textsFor(q.from.language_code).card.playGame, url: this.link() }]] },
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
      await this.deps.api.call('answerCallbackQuery', { callback_query_id: c.id, text: textsFor(c.from.language_code).card.giftResult[r.status] });
      if (r.status === 'ok' || r.status === 'full') await this.refresh(roomId);
      return;
    }
    await this.refresh(roomId);
    await this.deps.api.call('answerCallbackQuery', { callback_query_id: c.id, text: textsFor(c.from.language_code).card.refreshed });
  }
}
