import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef, Swap } from '@sakura/core';
import { signInitData } from '../src/auth.ts';
import { BotApi, webhookToken } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { createApp } from '../src/http.ts';
import { loadLevels } from '../src/levels.ts';
import { LIFE_REGEN_MS } from '../src/lives.ts';
import { GameService, TIME_GRACE_MS } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const TOKEN = '777:test';
// как у Render generateValue: base64 с символами, которые Telegram в secret_token не принимает
const SECRET = 'Hk+9/aZ=';
const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([
  [1, parseLevel({ ...base, id: 1, moves: 10, goals: [{ type: 'score', target: 1 }] })],
  [2, parseLevel({ ...base, id: 2, moves: 50, timeLimit: 30, goals: [{ type: 'score', target: 1 }] })],
  [3, parseLevel({ ...base, id: 3, moves: 3, goals: [{ type: 'collect', color: 0, count: 500 }] })],
]);

let clock = 1_760_000_000_000;
/** Сервис и бот текущего теста (пересоздаются в beforeEach). */
const ctx = {} as { service: GameService; chat: ChatBot };
let store: SqliteStore;
let url: string;
let server: ReturnType<typeof createApp>;
const botCalls: { method: string; params: Record<string, unknown> }[] = [];
const clientDir = mkdtempSync(join(tmpdir(), 'sakura-client-'));
mkdirSync(join(clientDir, 'assets'));
writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>Sakura</title>');
writeFileSync(join(clientDir, 'assets', 'app-123.js'), 'console.log(1)');

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const method = String(input).split('/').pop()!;
  botCalls.push({ method, params: JSON.parse(String(init?.body)) });
  const result = method === 'savePreparedInlineMessage' ? { id: `prep-${botCalls.length}`, expiration_date: 0 } : true;
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;

beforeEach(async () => {
  store?.close();
  server?.close();
  store = new SqliteStore(':memory:');
  let seq = 0;
  let chat: ChatBot | null = null;
  let roomSeq = 0;
  const service = new GameService({
    store, levels: LEVELS, now: () => clock, newSeed: () => 1000 + seq, newId: () => `att-${++seq}`,
    newRoomId: () => `rRoom${++roomSeq}`, onRoomChanged: (id) => void chat?.refresh(id),
  });
  chat = new ChatBot({
    api: new BotApi(TOKEN, fakeFetch), service, webAppUrl: 'https://game.example/', botUsername: 'sakura_test_bot',
    directLinks: false, refreshDelayMs: 0, now: () => clock,
  });
  ctx.service = service;
  ctx.chat = chat;
  server = createApp({ service, botToken: TOKEN, devAuth: true, clientDir, now: () => clock, bot: { chat, secret: SECRET } });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  botCalls.length = 0;
});
after(() => {
  server?.close();
  store?.close();
});
before(() => { clock = 1_760_000_000_000; });

const dev = (id = 1) => ({ authorization: `dev ${id}` });
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = dev()) {
  const res = await fetch(url + path, {
    method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

/** Сыграть партию на клиенте тем же ядром: первый допустимый ход, пока не кончится. */
function playLocally(levelId: number, seed: number, maxMoves = Infinity): Swap[] {
  const game = new Match3Game(gameOptionsFromLevel(LEVELS.get(levelId)!, seed));
  while (game.status === 'playing' && game.history.length < maxMoves) game.swap(game.validSwaps()[0]!);
  return [...game.history];
}

test('auth: required; Telegram signature accepted; dev only when enabled', async () => {
  assert.equal((await call('GET', '/api/me', undefined, {})).status, 401);
  const initData = signInitData({
    auth_date: String(Math.floor(clock / 1000)), user: JSON.stringify({ id: 99, first_name: 'Рэн' }),
  }, TOKEN);
  const me = await call('GET', '/api/me', undefined, { authorization: `tma ${initData}` });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { id: 99, firstName: 'Рэн' });
  assert.equal((await call('GET', '/api/me', undefined, { authorization: `tma ${initData.replace('99', '98')}` })).status, 401);
  assert.equal((await call('GET', '/api/me', undefined, { authorization: 'dev abc' })).status, 401);
});

test('new player: 5 lives, level 1 open, level 2 locked', async () => {
  const me = await call('GET', '/api/me');
  assert.deepEqual(me.body.lives, { lives: 5, max: 5, nextLifeAt: null, infiniteUntil: null });
  assert.equal(me.body.maxLevel, 1);
  assert.equal(me.body.levelCount, 3);
  const locked = await call('POST', '/api/attempts', { levelId: 3 });
  assert.equal(locked.status, 403);
  assert.equal(locked.body.error, 'level_locked');
  assert.equal((await call('POST', '/api/attempts', { levelId: 42 })).status, 404);
  assert.equal((await call('POST', '/api/attempts', { levelId: 'x' })).status, 400);
});

test('win: server replays the moves, refunds the life, unlocks the next level', async () => {
  const start = await call('POST', '/api/attempts', { levelId: 1 });
  assert.equal(start.status, 200);
  assert.equal(start.body.lives.lives, 4, 'life is reserved during the attempt');
  assert.equal(start.body.level.id, 1);
  const swaps = playLocally(1, start.body.seed);
  const fin = await call('POST', `/api/attempts/${start.body.attemptId}/finish`, { swaps });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.result, 'won');
  assert.ok(fin.body.score > 0 && fin.body.stars >= 1);
  assert.equal(fin.body.lives.lives, 5);
  assert.equal(fin.body.maxLevel, 2);
  const me = await call('GET', '/api/me');
  assert.deepEqual(me.body.levels[1], { stars: fin.body.stars, bestScore: fin.body.score });
  // повторная отправка того же результата не засчитывается второй раз
  assert.equal((await call('POST', `/api/attempts/${start.body.attemptId}/finish`, { swaps })).status, 409);
});

test('the client cannot claim a score: a forged move is rejected and the life is lost', async () => {
  const start = await call('POST', '/api/attempts', { levelId: 1 });
  const forged = await call('POST', `/api/attempts/${start.body.attemptId}/finish`, {
    swaps: [{ a: { row: 0, col: 0 }, b: { row: 5, col: 5 } }], score: 999999,
  });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, 'invalid_replay');
  assert.equal((await call('GET', '/api/me')).body.lives.lives, 4);
  const start2 = await call('POST', '/api/attempts', { levelId: 1 });
  const garbage = await call('POST', `/api/attempts/${start2.body.attemptId}/finish`, { swaps: 'lol' });
  assert.equal(garbage.status, 400);
});

test('loss keeps the life spent; regen brings it back after 30 minutes', async () => {
  await unlockLevel(3);
  const start = await call('POST', '/api/attempts', { levelId: 3 });
  const fin = await call('POST', `/api/attempts/${start.body.attemptId}/finish`, { swaps: playLocally(3, start.body.seed) });
  assert.equal(fin.body.result, 'lost');
  assert.equal(fin.body.lives.lives, 4);
  assert.equal(fin.body.lives.nextLifeAt, clock + LIFE_REGEN_MS);
  clock += LIFE_REGEN_MS;
  assert.equal((await call('GET', '/api/me')).body.lives.lives, 5);
});

test('no lives: start is refused with the time of the next life', async () => {
  await unlockLevel(3);
  for (let i = 0; i < 5; i++) {
    const s = await call('POST', '/api/attempts', { levelId: 3 });
    await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: playLocally(3, s.body.seed) });
  }
  const refused = await call('POST', '/api/attempts', { levelId: 3 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'no_lives');
  assert.equal(refused.body.lives.nextLifeAt, clock + LIFE_REGEN_MS);
  clock += LIFE_REGEN_MS;
  assert.equal((await call('POST', '/api/attempts', { levelId: 3 })).status, 200);
});

test('closing the app mid-level counts as a loss on the next start', async () => {
  await call('POST', '/api/attempts', { levelId: 1 });
  const second = await call('POST', '/api/attempts', { levelId: 1 });
  assert.equal(second.body.lives.lives, 3);
  assert.equal((await store.getAttempt('att-1'))?.status, 'abandoned');
});

test('hidden assist kicks in after 5 losses in a row on the level', async () => {
  await unlockLevel(3);
  for (let i = 0; i < 5; i++) {
    clock += LIFE_REGEN_MS * 5;
    const s = await call('POST', '/api/attempts', { levelId: 3 });
    assert.equal((await store.getAttempt(s.body.attemptId))?.assist, 0);
    await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: playLocally(3, s.body.seed) });
  }
  const s = await call('POST', '/api/attempts', { levelId: 3 });
  assert.equal((await store.getAttempt(s.body.attemptId))?.assist, 0.02);
  assert.equal(s.body.level.assist, undefined, 'never shown to the player');
  // реплей идёт с тем же облегчением — иначе честная партия не сошлась бы
  const game = new Match3Game({ ...gameOptionsFromLevel(LEVELS.get(3)!, s.body.seed), assist: 0.02 });
  while (game.status === 'playing') game.swap(game.validSwaps()[0]!);
  const fin = await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: game.history });
  assert.equal(fin.status, 200);
});

test('timed level: a win reported after the time limit is a loss', async () => {
  await unlockLevel(2);
  const s = await call('POST', '/api/attempts', { levelId: 2 });
  clock += 30_000 + TIME_GRACE_MS + 1;
  const fin = await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: playLocally(2, s.body.seed) });
  assert.equal(fin.body.result, 'lost');
  const s2 = await call('POST', '/api/attempts', { levelId: 2 });
  clock += 10_000;
  const ok = await call('POST', `/api/attempts/${s2.body.attemptId}/finish`, { swaps: playLocally(2, s2.body.seed) });
  assert.equal(ok.body.result, 'won');
});

test('someone else cannot finish my attempt', async () => {
  const s = await call('POST', '/api/attempts', { levelId: 1 });
  const res = await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: [] }, dev(2));
  assert.equal(res.status, 404);
});

test('bad input: large body, bad json, unknown route', async () => {
  const big = await fetch(`${url}/api/attempts`, { method: 'POST', headers: dev(), body: 'x'.repeat(70_000) });
  assert.equal(big.status, 413);
  const bad = await fetch(`${url}/api/attempts`, { method: 'POST', headers: dev(), body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
});

test('static client: SPA fallback, cache headers, no path traversal', async () => {
  const index = await fetch(`${url}/some/deep/link`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Sakura/);
  assert.equal(index.headers.get('cache-control'), 'no-cache');
  const asset = await fetch(`${url}/assets/app-123.js`);
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  for (const evil of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/package.json']) {
    const r = await fetch(url + evil);
    assert.ok(r.status === 403 || !(await r.text()).includes('"name"'), evil);
  }
  assert.equal((await fetch(`${url}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${url}/api/health`)).status, 200, 'server still alive');
});

test('bot webhook: secret required; /start answers with a web_app button', async () => {
  const update = { message: { chat: { id: 5, type: 'private' }, from: { first_name: 'Мика' }, text: '/start' } };
  assert.equal((await call('POST', '/telegram/webhook', update, { 'x-telegram-bot-api-secret-token': 'wrong' })).status, 401);
  assert.equal((await call('POST', '/telegram/webhook', update, { 'x-telegram-bot-api-secret-token': SECRET })).status, 401,
    'the raw secret is not the header value');
  const ok = await call('POST', '/telegram/webhook', update, { 'x-telegram-bot-api-secret-token': webhookToken(SECRET) });
  assert.equal(ok.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(botCalls.length, 1);
  assert.equal(botCalls[0]!.method, 'sendMessage');
  assert.equal(botCalls[0]!.params.chat_id, 5);
  assert.deepEqual((botCalls[0]!.params.reply_markup as any).inline_keyboard[0][0].web_app, { url: 'https://game.example/' });
  await call('POST', '/telegram/webhook', { message: { chat: { id: 6, type: 'group' }, text: '/start' } }, { 'x-telegram-bot-api-secret-token': webhookToken(SECRET) });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(botCalls.length, 1, 'groups are ignored for now');
});

test('levels from the repo load', () => {
  const levels = loadLevels(new URL('../../../levels', import.meta.url).pathname);
  assert.ok(levels.size >= 6);
});

async function unlockLevel(id: number): Promise<void> {
  for (let l = 1; l < id; l++) {
    const s = await call('POST', '/api/attempts', { levelId: l });
    const fin = await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: playLocally(l, s.body.seed) });
    assert.equal(fin.body.result, 'won', `unlock: won level ${l}`);
  }
}

test('bot profile and setup: limits respected, webhook and menu button point to the server', async () => {
  const { BOT_TEXT, setupBot, setupProfile } = await import('../src/bot.ts');
  assert.ok(BOT_TEXT.description.length <= 512);
  assert.ok(BOT_TEXT.shortDescription.length <= 120);
  const api = new BotApi(TOKEN, fakeFetch);
  await setupProfile(api);
  await setupBot(api, 'https://sakura.example/', 's3cret+/=');
  assert.deepEqual(botCalls.map((c) => c.method), ['setMyDescription', 'setMyShortDescription', 'setMyCommands', 'setWebhook', 'setChatMenuButton']);
  assert.equal(botCalls[3]!.params.url, 'https://sakura.example/telegram/webhook');
  assert.match(String(botCalls[3]!.params.secret_token), /^[A-Za-z0-9_-]{1,256}$/, 'Telegram-legal characters only');
  assert.equal(botCalls[3]!.params.secret_token, webhookToken('s3cret+/='));
  assert.deepEqual((botCalls[4]!.params.menu_button as any).web_app, { url: 'https://sakura.example/' });
});

test('analytics: install, level_start, level_win / level_fail with moves left and goal progress, lives_empty', async () => {
  const s = await call('POST', '/api/attempts', { levelId: 1 });
  await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: playLocally(1, s.body.seed) });
  await unlockLevel(3);
  const l = await call('POST', '/api/attempts', { levelId: 3 });
  await call('POST', `/api/attempts/${l.body.attemptId}/finish`, { swaps: playLocally(3, l.body.seed) });
  const events = await store.getEvents(1);
  assert.deepEqual(events.map((e) => e.name).slice(0, 3), ['install', 'level_start', 'level_win']);
  const win = events.find((e) => e.name === 'level_win')!;
  assert.equal(win.levelId, 1);
  assert.ok(typeof win.props.movesLeft === 'number' && typeof win.props.score === 'number');
  const fail = events.find((e) => e.name === 'level_fail')!;
  assert.equal(fail.levelId, 3);
  assert.equal(fail.props.reason, 'lost');
  assert.equal(fail.props.movesLeft, 0);
  assert.ok(typeof fail.props.goalProgress === 'number' && (fail.props.goalProgress as number) < 1);
  assert.equal(events.filter((e) => e.name === 'install').length, 1, 'install only once');

  const u = (await store.getUser(1))!;
  await store.saveLives(1, { ...u.lives, lives: 0, updatedAt: clock });
  await call('POST', '/api/attempts', { levelId: 1 });
  assert.equal((await store.getEvents(1)).at(-1)?.name, 'lives_empty');
});

test('analytics: client events are whitelisted and bounded', async () => {
  const res = await call('POST', '/api/events', { events: [
    { name: 'session_start' },
    { name: 'hint_shown', levelId: 4, props: { after: 7 } },
    { name: 'level_win', levelId: 1, props: { score: 999999 } },
    { name: 'session_end', props: { blob: 'x'.repeat(2000) } },
  ] });
  assert.deepEqual(res.body, { accepted: 2 });
  const names = (await store.getEvents(1)).map((e) => e.name);
  assert.ok(!names.includes('level_win'), 'game results come only from the server');
  assert.equal((await call('POST', '/api/events', { events: Array(21).fill({ name: 'session_start' }) })).status, 400);
  assert.equal((await call('POST', '/api/events', { events: 'x' })).status, 400);
});

test('report: funnel, D1 retention, per-level stats', async () => {
  const t0 = clock;
  await call('GET', '/api/me', undefined, dev(1));
  await call('GET', '/api/me', undefined, dev(2));
  const s = await call('POST', '/api/attempts', { levelId: 1 }, dev(1));
  await call('POST', `/api/attempts/${s.body.attemptId}/finish`, { swaps: playLocally(1, s.body.seed) }, dev(1));
  clock = t0 + 30 * 3600_000;
  await call('POST', '/api/events', { events: [{ name: 'session_start' }] }, dev(1));
  clock = t0 + 3 * 24 * 3600_000;
  const r = store.report(clock);
  assert.deepEqual(r.funnel, { installs: 2, level10: 0, level30: 0 });
  assert.deepEqual(r.d1, { cohort: 2, returned: 1, rate: 0.5 });
  assert.equal(r.levels[0]?.levelId, 1);
  assert.equal(r.levels[0]?.starts, 1);
  assert.equal(r.levels[0]?.winRate, 1);
  clock = t0;
});
