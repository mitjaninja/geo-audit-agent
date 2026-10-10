import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef, Move } from '@sakura/core';
import { BotApi } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { createApp } from '../src/http.ts';
import { GameService, MAX_ROOM_CARDS_PER_DAY, MIN_MS_PER_MOVE, ROOM_TTL_MS, roomLevelPool } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([
  [1, parseLevel({ ...base, id: 1, moves: 10, goals: [{ type: 'score', target: 1 }] })],
  [2, parseLevel({ ...base, id: 2, moves: 50, timeLimit: 30, goals: [{ type: 'score', target: 1 }] })],
  [3, parseLevel({ ...base, id: 3, moves: 6, goals: [{ type: 'score', target: 400 }] })],
  [4, parseLevel({ ...base, id: 4, moves: 6, goals: [{ type: 'score', target: 400 }] })],
]);

let clock = 1_760_000_000_000;
let store: SqliteStore;
let server: ReturnType<typeof createApp>;
let url: string;
let chat: ChatBot;
const calls: { method: string; params: any }[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const method = String(input).split('/').pop()!;
  calls.push({ method, params: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify({ ok: true, result: method === 'savePreparedInlineMessage' ? { id: 'prep-1' } : true }));
}) as typeof fetch;

beforeEach(async () => {
  store?.close();
  server?.close();
  store = new SqliteStore(':memory:');
  let seq = 0;
  let roomSeq = 0;
  const service = new GameService({
    store, levels: LEVELS, now: () => clock, newSeed: () => 1000 + seq, newId: () => `att-${++seq}`,
    newRoomId: () => `rRoom${++roomSeq}`, onRoomChanged: (id) => void chat.refresh(id),
  });
  chat = new ChatBot({ api: new BotApi('1:t', fakeFetch), service, webAppUrl: 'https://game.example/', botUsername: 'sk_bot', directLinks: false, refreshDelayMs: 0, now: () => clock });
  server = createApp({ service, botToken: '1:t', devAuth: true, now: () => clock, bot: { chat, secret: 's' } });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  calls.length = 0;
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

function play(levelId: number, seed: number, pick = 0): Move[] {
  const game = new Match3Game(gameOptionsFromLevel(LEVELS.get(levelId)!, seed));
  while (game.status === 'playing') {
    const s = game.validSwaps();
    game.swap(s[Math.min(pick, s.length - 1)]!);
  }
  return [...game.history];
}

async function playRoom(roomId: string, user: number, pick = 0) {
  const s = await call('POST', `/api/rooms/${roomId}/attempts`, undefined, user);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const swaps = play(s.body.level.id, s.body.seed, pick);
  clock += swaps.length * MIN_MS_PER_MOVE + 1000;
  return { start: s.body, finish: await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps }, user) };
}

const webhook = (update: unknown) => chat.handleUpdate(update);

test('migration: a pre-migration database moves to the latest version and keeps its data', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'sakura-db-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, username TEXT, language_code TEXT,
    created_at INTEGER NOT NULL, lives INTEGER NOT NULL, lives_updated_at INTEGER NOT NULL, infinite_until INTEGER NOT NULL DEFAULT 0,
    max_level INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE attempts (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, level_id INTEGER NOT NULL, seed INTEGER NOT NULL,
    assist REAL NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, status TEXT NOT NULL, finished_at INTEGER, score INTEGER, stars INTEGER, swaps TEXT);
    INSERT INTO users VALUES (7, 'Мика', NULL, NULL, 1, 3, 1, 0, 9);
    INSERT INTO attempts (id, user_id, level_id, seed, started_at, status) VALUES ('a1', 7, 2, 5, 1, 'won');`);
  old.close();
  const s = new SqliteStore(path);
  assert.equal(s.schemaVersion, 3);
  return Promise.all([s.getUser(7), s.getAttempt('a1'), s.getWallet(7)]).then(([u, a, w]) => {
    assert.equal(u?.maxLevel, 9);
    assert.equal(u?.lives.lives, 3);
    assert.equal(a?.roomId, null);
    assert.deepEqual(a?.startBoosters, []);
    assert.equal(w.crystals, 0);
    assert.deepEqual(Object.values(w.items), [3, 3, 3, 3, 3, 3], 'existing players get the free boosters too');
    s.close();
    assert.equal(new SqliteStore(path).schemaVersion, 3, 'reopening does not re-run migrations');
  });
});

test('room level pool: no timed, no tutorial level, within the creator progress (at least up to 4)', () => {
  assert.deepEqual(roomLevelPool(LEVELS, 1), [3, 4]);
  assert.deepEqual(roomLevelPool(LEVELS, 3), [3, 4]);
});

test('challenge: share card, free first attempt, then a life; ranking with places; map progress untouched', async () => {
  const created = await call('POST', '/api/rooms', { mode: 'challenge' });
  assert.equal(created.status, 200);
  const { roomId } = created.body;
  assert.equal(created.body.preparedMessageId, 'prep-1');
  assert.equal(created.body.link, `https://t.me/sk_bot?start=${roomId}`);
  const prepared = calls.find((c) => c.method === 'savePreparedInlineMessage')!;
  assert.equal(prepared.params.user_id, 1);
  assert.equal(prepared.params.result.reply_markup.inline_keyboard[0][0].url, `https://t.me/sk_bot?start=${roomId}`);

  const a = await playRoom(roomId, 1);
  assert.equal(a.start.lives.lives, 5, 'first attempt is free');
  assert.deepEqual(a.finish.body.room, { id: roomId, place: 1, players: 1 });
  const b = await playRoom(roomId, 1, 3);
  assert.equal(b.start.lives.lives, 4, 'the second attempt costs a life');
  const c = await playRoom(roomId, 2, 1);
  assert.equal(c.start.lives.lives, 5);

  const view = (await call('GET', `/api/rooms/${roomId}`, undefined, 2)).body;
  assert.equal(view.players, 2);
  assert.equal(view.top.length, 2);
  assert.ok(view.top[0].score >= view.top[1].score);
  assert.equal(view.me.attempts, 1);
  assert.equal(view.nextAttemptFree, false);
  const me = (await call('GET', '/api/me')).body;
  assert.equal(me.maxLevel, 1, 'room games do not unlock map levels');
  assert.deepEqual(me.levels, {});
});

test('share falls back to a link when the Bot API refuses to prepare the card', async () => {
  const failing = (async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: USER_ID_INVALID' }))) as unknown as typeof fetch;
  const service = new GameService({ store, levels: LEVELS, now: () => clock });
  const bot = new ChatBot({ api: new BotApi('1:t', failing), service, webAppUrl: 'https://game.example/', botUsername: 'sk_bot', directLinks: true });
  const app = createApp({ service, botToken: '1:t', devAuth: true, now: () => clock, bot: { chat: bot, secret: 's' } });
  await new Promise<void>((r) => app.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/api/rooms`, {
    method: 'POST', headers: { authorization: 'dev 1', 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'challenge' }),
  });
  const body = (await res.json()) as any;
  app.close();
  assert.equal(res.status, 200);
  assert.equal(body.preparedMessageId, null);
  assert.match(body.link, /^https:\/\/t\.me\/sk_bot\?startapp=r/, 'direct startapp link when Main Mini App is on');
});

test('anti-cheat: moves faster than animations are rejected', async () => {
  const { roomId } = (await call('POST', '/api/rooms', { mode: 'challenge' })).body;
  const s = (await call('POST', `/api/rooms/${roomId}/attempts`)).body;
  const swaps = play(s.level.id, s.seed);
  clock += 10;
  const res = await call('POST', `/api/attempts/${s.attemptId}/finish`, { swaps });
  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'too_fast');
  assert.equal((await call('GET', `/api/rooms/${roomId}`)).body.players, 0);
});

test('expired room is closed; unknown room is 404', async () => {
  const { roomId } = (await call('POST', '/api/rooms', { mode: 'challenge' })).body;
  clock += ROOM_TTL_MS + 1;
  assert.equal((await call('POST', `/api/rooms/${roomId}/attempts`)).status, 410);
  assert.equal((await call('GET', '/api/rooms/rNope')).status, 404);
  assert.equal((await call('POST', '/api/rooms', { mode: 'duel' })).status, 400);
});

test('limit: 5 cards per day that reached a chat', async () => {
  for (let i = 0; i < MAX_ROOM_CARDS_PER_DAY; i++) {
    const { roomId } = (await call('POST', '/api/rooms', { mode: 'help' })).body;
    await store.setRoomMessage(roomId, `inline-${i}`);
  }
  const refused = await call('POST', '/api/rooms', { mode: 'challenge' });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, 'room_limit');
  clock += 24 * 3600_000 + 1;
  assert.equal((await call('POST', '/api/rooms', { mode: 'challenge' })).status, 200);
});

test('inline mode: challenge and help cards with the right buttons', async () => {
  await webhook({ inline_query: { id: 'q1', from: { id: 5, first_name: 'Рэн' }, query: '' } });
  const answer = calls.find((c) => c.method === 'answerInlineQuery')!;
  assert.equal(answer.params.is_personal, true);
  const [ch, help] = answer.params.results;
  assert.match(ch.input_message_content.message_text, /Челлендж чата/);
  assert.equal(ch.reply_markup.inline_keyboard[0][0].url, `https://t.me/sk_bot?start=${ch.id}`);
  assert.equal(ch.reply_markup.inline_keyboard[1][0].callback_data, `top:${ch.id}`);
  assert.match(help.input_message_content.message_text, /Рэн просит жизнь/);
  assert.equal(help.reply_markup.inline_keyboard[0][0].callback_data, `gift:${help.id}`);
  assert.ok(await store.getUser(5), 'the inline user is registered');
});

test('/start with a room opens the game on that room; unknown room falls back', async () => {
  const { roomId } = (await call('POST', '/api/rooms', { mode: 'challenge' })).body;
  calls.length = 0;
  await webhook({ message: { chat: { id: 9, type: 'private' }, from: { id: 9, first_name: 'Сэцу' }, text: `/start ${roomId}` } });
  assert.equal(calls[0]!.params.reply_markup.inline_keyboard[0][0].web_app.url, `https://game.example/?room=${roomId}`);
  await webhook({ message: { chat: { id: 9, type: 'private' }, text: '/start rGone' } });
  assert.match(calls[1]!.params.text, /закрыта/);
});

test('ranking card: the first button press binds the card; results edit it', async () => {
  const { roomId } = (await call('POST', '/api/rooms', { mode: 'challenge' })).body;
  await webhook({ callback_query: { id: 'cb1', from: { id: 3 }, data: `top:${roomId}`, inline_message_id: 'IM-1' } });
  assert.ok(calls.some((c) => c.method === 'answerCallbackQuery'));
  calls.length = 0;
  await playRoom(roomId, 1);
  await new Promise((r) => setTimeout(r, 20));
  const edit = calls.find((c) => c.method === 'editMessageText')!;
  assert.equal(edit.params.inline_message_id, 'IM-1');
  assert.match(edit.params.text, /🥇 Dev 1 — \d/);
  assert.match(edit.params.text, /Сыграли: 1/);
});

test('help card: friends gift lives once each, up to 5; not to yourself', async () => {
  // у просящего 3 жизни
  await call('GET', '/api/me');
  const u = (await store.getUser(1))!;
  await store.saveLives(1, { ...u.lives, lives: 1, updatedAt: clock });
  const { roomId } = (await call('POST', '/api/rooms', { mode: 'help' })).body;
  const press = async (from: number) => {
    calls.length = 0;
    await webhook({ callback_query: { id: `cb${from}`, from: { id: from, first_name: `F${from}` }, data: `gift:${roomId}`, inline_message_id: 'IM-H' } });
    return calls.find((c) => c.method === 'answerCallbackQuery')!.params.text as string;
  };
  assert.match(await press(1), /Себе/);
  assert.match(await press(2), /отправлена/);
  assert.equal((await store.getUser(1))!.lives.lives, 2);
  assert.match(await press(2), /уже дарил/);
  for (const id of [3, 4, 5, 6]) await press(id);
  assert.match(await press(7), /5 жизней/);
  assert.equal((await store.getRoom(roomId))!.gifts, 5);
  assert.equal((await store.getUser(1))!.lives.lives, 5, 'capped at the maximum');
  const events = await store.getEvents(2);
  assert.ok(events.some((e) => e.name === 'life_gift'));
});
