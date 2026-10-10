import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { BotApi } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { GameService } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';
import { langOf, LANGS, TEXTS } from '../src/texts.ts';

const LEVELS = new Map<number, LevelDef>([[1, parseLevel({ id: 1, width: 6, height: 6, colors: 5, moves: 10, difficulty: 'normal', stars: [1, 2, 3], goals: [{ type: 'score', target: 1 }] })]]);

test('language from Telegram language_code', () => {
  assert.equal(langOf('ru'), 'ru');
  assert.equal(langOf('be'), 'ru');
  assert.equal(langOf('es'), 'es');
  assert.equal(langOf('pt-br'), 'pt');
  assert.equal(langOf('fr'), 'en');
  assert.equal(langOf(undefined), 'ru');
  // профиль бота в лимитах Telegram на всех языках
  for (const l of LANGS) {
    assert.ok(TEXTS[l].bot.description.length <= 512, l);
    assert.ok(TEXTS[l].bot.shortDescription.length <= 120, l);
  }
});

test('bot replies, pushes, invoices and chat cards speak the player’s language', async () => {
  const store = new SqliteStore(':memory:');
  const sent: any[] = [];
  const api = new BotApi('1:t', (async (url: string, init?: RequestInit) => {
    const params = JSON.parse(String(init?.body));
    sent.push({ method: String(url).split('/').pop(), params });
    return new Response(JSON.stringify({ ok: true, result: String(url).endsWith('savePreparedInlineMessage') ? { id: 'p' } : true }));
  }) as typeof fetch);
  let chat: ChatBot;
  const service = new GameService({ store, levels: LEVELS, sendPush: (id, text, tx) => chat.push(id, text, tx) });
  chat = new ChatBot({ api, service, webAppUrl: 'https://g/', botUsername: 'b', directLinks: true });

  await chat.handleUpdate({ message: { chat: { id: 7, type: 'private' }, from: { id: 7, first_name: 'Ana', language_code: 'es' }, text: '/start' } });
  assert.match(sent.at(-1).params.text, /^¡Hola, Ana!/);
  assert.equal(sent.at(-1).params.reply_markup.inline_keyboard[0][0].text, 'Jugar');

  await service.login({ id: 8, firstName: 'Bob', languageCode: 'en', allowsPm: true });
  await service.push(8, (tx) => tx.push.livesBack);
  assert.match(sent.at(-1).params.text, /^Your lives are full again[\s\S]*Turn off notifications: \/notify off$/);

  await service.login({ id: 9, firstName: 'Rui', languageCode: 'pt-br' });
  const inv = await service.createInvoice(9, 'pack50');
  assert.equal(inv.title, 'Saquinho de cristais');
  assert.match(inv.description, /50 cristais estelares/);

  // карточка — на языке создателя
  const room = await service.createRoom(8, 'challenge');
  await chat.prepare(room, 8);
  const card = sent.find((c) => c.method === 'savePreparedInlineMessage').params.result;
  assert.equal(card.title, '1-hour tournament');
  assert.match(card.input_message_content.message_text, /60 min left/);
  assert.match(card.input_message_content.message_text, /Nobody has played yet/);
  store.close();
});
