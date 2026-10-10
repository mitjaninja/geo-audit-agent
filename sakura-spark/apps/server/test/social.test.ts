import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { BotApi } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { createApp } from '../src/http.ts';
import { LIFE_REGEN_MS } from '../src/lives.ts';
import { GameService, MIN_MS_PER_MOVE, ServiceError } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([...Array(35).keys()].map((i) => [i + 1, parseLevel({ ...base, id: i + 1, moves: 10, goals: [{ type: 'score', target: 1 }] })]));
const HOUR = 3600_000;

let clock = Date.UTC(2026, 9, 10, 9, 0, 0);
let store: SqliteStore;
let service: GameService;
let server: ReturnType<typeof createApp>;
let url: string;
let chat: ChatBot;
const pushes: { to: number; text: string }[] = [];
const sent: { chat_id: number; text: string }[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const params = JSON.parse(String(init?.body));
  if (String(input).endsWith('/sendMessage')) sent.push(params);
  return new Response(JSON.stringify({ ok: true, result: true }));
}) as typeof fetch;

beforeEach(async () => {
  store?.close();
  server?.close();
  clock = Date.UTC(2026, 9, 10, 9, 0, 0);
  store = new SqliteStore(':memory:');
  let seq = 0;
  service = new GameService({
    store, levels: LEVELS, now: () => clock, newSeed: () => 1000 + seq, newId: () => `att-${++seq}`,
    sendPush: async (to, text) => {
      pushes.push({ to, text });
      return true;
    },
  });
  chat = new ChatBot({ api: new BotApi('1:t', fakeFetch), service, webAppUrl: 'https://g/', botUsername: 'sakurabot', directLinks: true, refreshDelayMs: 0 });
  server = createApp({ service, botToken: '1:t', devAuth: true, now: () => clock, bot: { chat, secret: 's' } });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  pushes.length = 0;
  sent.length = 0;
});
after(() => {
  server?.close();
  store?.close();
});

async function call(method: string, path: string, body?: unknown, user = 1) {
  const res = await fetch(url + path, {
    method, headers: { 'content-type': 'application/json', authorization: `dev ${user}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const player = (id: number, name = `P${id}`, opts: { startParam?: string } = {}) => service.login({ id, firstName: name, allowsPm: true }, opts);
const setMaxLevel = (id: number, n: number) => (store as any).db.prepare('UPDATE users SET max_level = ? WHERE id = ?').run(n, id);
const flush = () => new Promise((r) => setTimeout(r, 10));

async function win(levelId: number, user: number) {
  const s = await service.startAttempt(user, levelId);
  const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
  return service.finishAttempt(user, s.attemptId, g.history, false);
}

test('referral: a newcomer by the invite link becomes a friend; the inviter gets 20 crystals once the friend reaches level 10', async () => {
  await player(1, 'Мика');
  await player(2, 'Рэн', { startParam: 'fr1' });
  await flush();
  assert.equal((await service.friendsView(1)).friends[0]!.name, 'Рэн');
  assert.match(pushes.at(-1)!.text, /Рэн пришёл по твоему приглашению/);
  await player(3, 'Сэцу', { startParam: 'fr3' }); // сам себя
  await player(1, 'Мика', { startParam: 'fr3' }); // уже играл
  assert.equal((await service.friendsView(3)).friends.length, 0);
  assert.equal((await service.friendsView(1)).friends.length, 1);

  setMaxLevel(2, 9);
  await win(9, 2);
  assert.equal((await store.getWallet(1)).crystals, 0, 'not yet');
  await win(10, 2);
  await flush();
  assert.equal((await store.getWallet(1)).crystals, 20);
  assert.match(pushes.at(-1)!.text, /Рэн дошёл до уровня 10 — тебе 20 💎/);
  await win(10, 2);
  assert.equal((await store.getWallet(1)).crystals, 20, 'only once');
});

test('lives: send one per friend per day, up to 5 a day; accept only when not full; ask friends', async () => {
  await player(1);
  for (let f = 2; f <= 8; f++) {
    await player(f);
    await service.befriend(1, f, 'test');
  }
  await player(99);
  assert.equal((await call('POST', '/api/friends/99/life')).body.error, 'not_friends');
  assert.equal((await call('POST', '/api/friends/2/life')).body.giftsLeft, 4);
  assert.equal((await call('POST', '/api/friends/2/life')).body.error, 'already');
  for (let f = 3; f <= 6; f++) assert.equal((await call('POST', `/api/friends/${f}/life`)).status, 200);
  const over = await call('POST', '/api/friends/7/life');
  assert.equal(over.status, 429);
  const view = (await call('GET', '/api/friends')).body;
  assert.equal(view.giftsLeft, 0);
  assert.equal(view.inviteLink, 'https://t.me/sakurabot?startapp=fr1');
  assert.equal(view.friends.filter((f: any) => f.sentToday).length, 5);

  // у друга 2 жизни полные — подарок ждёт в почте
  const inbox = (await call('GET', '/api/friends', undefined, 2)).body.inbox;
  assert.equal(inbox[0].kind, 'life');
  assert.equal((await call('POST', `/api/mail/${inbox[0].id}`, {}, 2)).body.error, 'lives_full');
  await store.saveLives(2, { lives: 3, updatedAt: clock, infiniteUntil: 0 });
  const took = await call('POST', `/api/mail/${inbox[0].id}`, {}, 2);
  assert.equal(took.body.lives.lives, 4);
  assert.equal((await call('POST', `/api/mail/${inbox[0].id}`, {}, 2)).body.error, 'already');
  assert.equal((await call('POST', `/api/mail/${inbox[0].id}`, {}, 3)).status, 404, 'not your mail');

  // просьба о жизни: всем друзьям раз в день; ответ — подарок жизни
  assert.equal((await call('POST', '/api/friends/ask', {}, 8)).body.asked, 1);
  assert.equal((await call('POST', '/api/friends/ask', {}, 8)).body.asked, 0, 'once a day');
  const ask = (await call('GET', '/api/friends')).body.inbox.find((m: any) => m.kind === 'ask_life');
  assert.equal(ask.from.id, 8);
  // у игрока 1 лимит подарков исчерпан — ответить нельзя
  assert.equal((await call('POST', `/api/mail/${ask.id}`)).status, 429);
  clock += 24 * HOUR;
  assert.equal((await call('POST', `/api/mail/${ask.id}`)).status, 200);
  assert.equal((await call('GET', '/api/friends', undefined, 8)).body.inbox[0].kind, 'life');
});

test('pushes: at most 2 a day, not when notifications are off or the bot is not allowed', async () => {
  await player(1);
  await player(2);
  await service.befriend(1, 2, 'test');
  for (let i = 0; i < 4; i++) await service.push(2, `hi ${i}`);
  assert.deepEqual(pushes.map((p) => p.text), ['hi 0', 'hi 1']);
  clock += 24 * HOUR;
  await service.setNotify(2, false);
  assert.equal(await service.push(2, 'off'), false);
  await service.setNotify(2, true);
  await service.login({ id: 2, firstName: 'P2', allowsPm: false });
  assert.equal(await service.push(2, 'no pm'), false);
  assert.equal(pushes.length, 2);
});

test('district gate: 3 keys from friends, or 24 h, or crystals', async () => {
  await player(1);
  for (const f of [2, 3, 4]) {
    await player(f);
    await service.befriend(1, f, 'test');
  }
  setMaxLevel(1, 15);
  const fin = await win(15, 1);
  assert.equal(fin.gate?.episode, 2);
  assert.equal(fin.gate?.keys, 0);
  await assert.rejects(service.startAttempt(1, 16), (e: unknown) => e instanceof ServiceError && e.code === 'episode_locked');
  assert.equal((await call('GET', '/api/me')).body.gate.levelId, 16);
  assert.equal((await call('POST', '/api/gate/ask')).body.asked, 3);
  for (const f of [2, 3, 4]) {
    const m = (await call('GET', '/api/friends', undefined, f)).body.inbox.find((x: any) => x.kind === 'ask_key');
    assert.equal((await call('POST', `/api/mail/${m.id}`, {}, f)).status, 200);
    if (f === 3) assert.equal((await service.gate(1))?.keys, 2);
  }
  assert.equal(await service.gate(1), null, 'three keys open the district');
  assert.equal((await service.startAttempt(1, 16)).level.id, 16);

  // без друзей: ждать 24 ч или заплатить
  await player(5);
  setMaxLevel(5, 30);
  await win(30, 5);
  assert.equal((await call('POST', '/api/gate/buy', {}, 5)).body.error, 'no_crystals');
  await store.transact(5, () => ({ crystals: 40 }));
  assert.equal((await call('POST', '/api/gate/buy', {}, 5)).body.wallet.crystals, 11);
  assert.equal(await service.gate(5), null);
  await player(6);
  setMaxLevel(6, 15);
  await win(15, 6);
  clock += 24 * HOUR;
  assert.equal(await service.gate(6), null, 'opens after a day');
  // кто уже стоял у ворот до обновления — не запираем
  await player(7);
  setMaxLevel(7, 16);
  assert.equal(await service.gate(7), null);
});

test('chat rooms and life gifts make friends; friends leaderboard on a level; "overtook you" push', async () => {
  await player(1, 'Мика');
  await player(2, 'Рэн');
  const room = await service.createRoom(1, 'challenge');
  const s = await service.startRoomAttempt(2, room.id);
  const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
  clock += g.history.length * MIN_MS_PER_MOVE + 1000;
  await service.finishAttempt(2, s.attemptId, g.history, false);
  assert.deepEqual((await service.friendsView(1)).friends.map((f) => f.id), [2]);

  await player(3, 'Сэцу');
  const help = await service.createRoom(1, 'help');
  await service.giftLife(help.id, { id: 3, firstName: 'Сэцу' });
  assert.equal((await service.friendsView(3)).friends[0]?.id, 1);

  // рейтинг уровня 1 среди друзей
  await win(1, 2);
  await win(1, 1);
  const top = await service.levelFriends(1, 1);
  assert.equal((await call('GET', '/api/levels/1/friends', undefined, 2)).body.top.length, 2);
  assert.deepEqual(top.map((r: any) => r.me), top.map((r: any) => r.name === 'Мика'));
  assert.equal(top.length, 2);
  // обогнать друга — ему пуш
  pushes.length = 0;
  (store as any).db.prepare('UPDATE level_progress SET best_score = 1 WHERE user_id = 1 AND level_id = 1').run();
  (store as any).db.prepare('UPDATE level_progress SET best_score = 2 WHERE user_id = 2 AND level_id = 1').run();
  await win(1, 1);
  await flush();
  assert.ok(pushes.some((p) => p.to === 2 && /Мика обогнал тебя на уровне 1/.test(p.text)));
});

test('"lives are back" push once for players who ran out', async () => {
  await player(1);
  await store.saveLives(1, { lives: 0, updatedAt: clock, infiniteUntil: 0 });
  assert.equal(await service.pushLivesRefilled(), 0);
  clock += 5 * LIFE_REGEN_MS;
  assert.equal(await service.pushLivesRefilled(), 1);
  assert.equal(await service.pushLivesRefilled(), 0, 'once');
  assert.match(pushes[0]!.text, /Жизни восстановились/);
});

test('bot: /start fr<id> registers the referral; /notify off|on; push carries a play button', async () => {
  await player(1, 'Мика');
  await chat.handleUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 5, first_name: 'Пон' }, text: '/start fr1' } });
  assert.equal((await service.friendsView(1)).friends[0]?.name, 'Пон');
  assert.ok(sent.at(-1)!.text.length > 0);
  await chat.handleUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 5, first_name: 'Пон' }, text: '/notify off' } });
  assert.match(sent.at(-1)!.text, /выключены/);
  assert.equal((await store.getUser(5))!.notify, false);
  assert.equal(await chat.push(1, 'Привет'), true);
  const msg = sent.at(-1) as any;
  assert.equal(msg.chat_id, 1);
  assert.match(msg.text, /\/notify off/);
  assert.equal(msg.reply_markup.inline_keyboard[0][0].web_app.url, 'https://g/');
});
