import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel, START_EXTRA_MOVES } from '@sakura/core';
import type { GameOptions, LevelDef, Move } from '@sakura/core';
import { BotApi } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { DEFAULT_ECONOMY } from '../src/economy.ts';
import type { Economy } from '../src/economy.ts';
import { createApp } from '../src/http.ts';
import { GameService, MIN_MS_PER_MOVE } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([
  [1, parseLevel({ ...base, id: 1, moves: 10, goals: [{ type: 'score', target: 1 }] })],
  [2, parseLevel({ ...base, id: 2, moves: 3, goals: [{ type: 'collect', color: 0, count: 500 }] })],
  [3, parseLevel({ ...base, id: 3, moves: 8, goals: [{ type: 'score', target: 300 }] })],
  [4, parseLevel({ ...base, id: 4, moves: 8, goals: [{ type: 'score', target: 300 }] })],
]);
// стартовый пак открывается после уровня 1, копилку можно разбить с 3 кристаллов — чтобы проверить на коротких фикстурах
const ECONOMY: Economy = { ...DEFAULT_ECONOMY, starter: { ...DEFAULT_ECONOMY.starter, afterLevel: 1 }, piggy: { ...DEFAULT_ECONOMY.piggy, minToBreak: 3 } };

let clock = 1_760_000_000_000;
let store: SqliteStore;
let server: ReturnType<typeof createApp>;
let url: string;
let chat: ChatBot;
const calls: { method: string; params: any }[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const method = String(input).split('/').pop()!;
  calls.push({ method, params: JSON.parse(String(init?.body)) });
  const result = method === 'createInvoiceLink' ? 'https://t.me/$invoice-link' : method === 'savePreparedInlineMessage' ? { id: 'p' } : true;
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;

beforeEach(async () => {
  store?.close();
  server?.close();
  store = new SqliteStore(':memory:');
  let seq = 0;
  const service = new GameService({ store, levels: LEVELS, now: () => clock, newSeed: () => 1000 + seq, newId: () => `att-${++seq}`, economy: ECONOMY });
  chat = new ChatBot({ api: new BotApi('1:t', fakeFetch), service, webAppUrl: 'https://g/', botUsername: 'b', directLinks: false, refreshDelayMs: 0, adminIds: [777] });
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

const optionsOf = (start: any, boosters: string[] = []): GameOptions => {
  const o = gameOptionsFromLevel(start.level, start.seed);
  return boosters.length === 0 ? o : { ...o, startBoosters: { beamBomb: boosters.includes('beamBomb'), rainbow: boosters.includes('rainbow'), extraMoves: boosters.includes('extraMoves') } };
};
const playOut = (g: Match3Game) => {
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
};
const giveCrystals = (n: number, user = 1) => store.transact(user, (w) => ({ crystals: w.crystals + n }));
const finish = (attemptId: string, moves: readonly Move[], user = 1) => call('POST', `/api/attempts/${attemptId}/finish`, { swaps: moves }, user);

test('a new player has no crystals and 3 of every booster', async () => {
  const me = (await call('GET', '/api/me')).body;
  assert.equal(me.wallet.crystals, 0);
  assert.deepEqual(me.wallet.items, { beamBomb: 3, rainbow: 3, extraMoves: 3, hammer: 3, freeSwap: 3, shuffle: 3 });
  assert.equal(me.wallet.starterUntil, null);
  const shop = (await call('GET', '/api/shop')).body;
  assert.equal(shop.itemPrices.hammer, 15);
  assert.deepEqual(shop.extendPrices, [9, 15, 25]);
  assert.equal(shop.packs.pack500.stars, 1900);
});

test('start boosters are taken at start and change the replayed game; none left — refused', async () => {
  const s = (await call('POST', '/api/attempts', { levelId: 1, boosters: ['beamBomb', 'extraMoves'] })).body;
  assert.equal(s.wallet.items.beamBomb, 2);
  assert.equal(s.wallet.items.extraMoves, 2);
  const g = new Match3Game(optionsOf(s, ['beamBomb', 'extraMoves']));
  assert.equal(g.movesLeft, 10 + START_EXTRA_MOVES);
  playOut(g);
  const fin = await finish(s.attemptId, g.history);
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.equal(fin.body.result, 'won');
  await store.transact(1, () => ({ items: { rainbow: 0 } }));
  const refused = await call('POST', '/api/attempts', { levelId: 1, boosters: ['rainbow'] });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'no_items');
  assert.equal((await call('POST', '/api/attempts', { levelId: 1, boosters: ['hammer'] })).status, 400, 'not a start booster');
  assert.equal((await call('POST', '/api/attempts', { levelId: 1, boosters: ['beamBomb', 'beamBomb'] })).status, 400);
});

test('in-game boosters are checked against the stock at finish', async () => {
  const s = (await call('POST', '/api/attempts', { levelId: 1 })).body;
  const g = new Match3Game(optionsOf(s));
  g.useBooster({ booster: 'shuffle' });
  g.useBooster({ booster: 'shuffle' });
  playOut(g);
  const fin = await finish(s.attemptId, g.history);
  assert.equal(fin.body.wallet.items.shuffle, 1);
  // без запаса — результат не засчитывается
  await store.transact(1, () => ({ items: { hammer: 0 } }));
  const s2 = (await call('POST', '/api/attempts', { levelId: 1 })).body;
  const g2 = new Match3Game(optionsOf(s2));
  g2.useBooster({ booster: 'hammer', at: { row: 0, col: 0 } });
  playOut(g2);
  const bad = await finish(s2.attemptId, g2.history);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, 'no_boosters');
});

test('+5 moves: only when out of moves, prices 9 → 15 → 25 → 25, unpaid extra moves are rejected', async () => {
  await (async () => {
    // уровень 2 открыть
    const s = (await call('POST', '/api/attempts', { levelId: 1 })).body;
    const g = new Match3Game(optionsOf(s));
    playOut(g);
    await finish(s.attemptId, g.history);
  })();
  const s = (await call('POST', '/api/attempts', { levelId: 2 })).body;
  const g = new Match3Game(optionsOf(s));
  g.swap(g.validSwaps()[0]!);
  assert.equal((await call('POST', `/api/attempts/${s.attemptId}/extend`, { moves: g.history })).status, 400, 'moves are left');
  playOut(g);
  const poor = await call('POST', `/api/attempts/${s.attemptId}/extend`, { moves: g.history });
  assert.equal(poor.status, 402);
  assert.equal(poor.body.price, 9);
  await giveCrystals(100);
  const prices: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', `/api/attempts/${s.attemptId}/extend`, { moves: g.history });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    prices.push(r.body.price);
    assert.equal(g.addMoves(5).valid, true);
    playOut(g);
  }
  assert.deepEqual(prices, [9, 15, 25, 25]);
  assert.equal((await call('GET', '/api/me')).body.wallet.crystals, 100 - 74);
  // лишняя неоплаченная докупка
  g.addMoves(5);
  playOut(g);
  const bad = await finish(s.attemptId, g.history);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, 'unpaid_moves');
  const events = (await store.getEvents(1)).filter((e) => e.name === 'moves_purchased');
  assert.equal(events.length, 4);
});

test('shop: boosters for crystals; full lives for 12', async () => {
  assert.equal((await call('POST', '/api/shop/buy', { item: 'hammer' })).status, 402);
  await giveCrystals(40);
  const bought = await call('POST', '/api/shop/buy', { item: 'hammer', count: 2 });
  assert.equal(bought.body.wallet.crystals, 10);
  assert.equal(bought.body.wallet.items.hammer, 5);
  assert.equal((await call('POST', '/api/shop/buy', { item: 'gold' })).status, 400);
  assert.equal((await call('POST', '/api/lives/refill')).status, 400, 'lives are full');
  const u = (await store.getUser(1))!;
  await store.saveLives(1, { ...u.lives, lives: 0, updatedAt: clock });
  assert.equal((await call('POST', '/api/lives/refill')).status, 402, 'not enough crystals');
  await giveCrystals(10);
  const r = await call('POST', '/api/lives/refill');
  assert.equal(r.body.lives.lives, 5);
  assert.equal(r.body.wallet.crystals, 8);
});

test('Stars: invoice, pre-checkout check, credit exactly once, admin refund', async () => {
  const inv = await call('POST', '/api/purchases', { product: 'pack50' });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.link, 'https://t.me/$invoice-link');
  const link = calls.find((c) => c.method === 'createInvoiceLink')!.params;
  assert.equal(link.currency, 'XTR');
  assert.deepEqual(link.prices, [{ label: 'Мешочек кристаллов', amount: 225 }]);
  const payload = link.payload as string;

  await chat.handleUpdate({ pre_checkout_query: { id: 'pq1', from: { id: 1 }, currency: 'XTR', total_amount: 1, invoice_payload: payload } });
  assert.equal(calls.at(-1)!.params.ok, false, 'wrong amount');
  await chat.handleUpdate({ pre_checkout_query: { id: 'pq2', from: { id: 2 }, currency: 'XTR', total_amount: 225, invoice_payload: payload } });
  assert.equal(calls.at(-1)!.params.ok, false, 'someone else');
  await chat.handleUpdate({ pre_checkout_query: { id: 'pq3', from: { id: 1 }, currency: 'XTR', total_amount: 225, invoice_payload: payload } });
  assert.deepEqual(calls.at(-1)!.params, { pre_checkout_query_id: 'pq3', ok: true });

  const paid = { message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, successful_payment: {
    currency: 'XTR', total_amount: 225, invoice_payload: payload, telegram_payment_charge_id: 'ch-1' } } };
  await chat.handleUpdate(paid);
  await chat.handleUpdate(paid);
  assert.equal((await call('GET', '/api/me')).body.wallet.crystals, 50, 'credited once');
  await chat.handleUpdate({ pre_checkout_query: { id: 'pq4', from: { id: 1 }, currency: 'XTR', total_amount: 225, invoice_payload: payload } });
  assert.equal(calls.at(-1)!.params.ok, false, 'an invoice is paid once');

  calls.length = 0;
  await chat.handleUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 5 }, text: '/refund ch-1' } });
  assert.equal(calls.length, 0, 'not an admin');
  await chat.handleUpdate({ message: { chat: { id: 777, type: 'private' }, from: { id: 777 }, text: '/refund ch-1' } });
  assert.deepEqual(calls.find((c) => c.method === 'refundStarPayment')!.params, { user_id: 1, telegram_payment_charge_id: 'ch-1' });
  assert.equal((await call('GET', '/api/me')).body.wallet.crystals, 0);
  await chat.handleUpdate({ message: { chat: { id: 777, type: 'private' }, from: { id: 777 }, text: '/refund ch-1' } });
  assert.match(calls.at(-1)!.params.text, /Уже возвращён/);
  assert.equal((await call('POST', '/api/purchases', { product: 'gold' })).status, 400);
});

test('starter pack opens once after level N for 48 h; piggy bank grows with wins', async () => {
  assert.equal((await call('POST', '/api/purchases', { product: 'starter' })).status, 409, 'not yet');
  const s = (await call('POST', '/api/attempts', { levelId: 1 })).body;
  const g = new Match3Game(optionsOf(s));
  playOut(g);
  const fin = (await finish(s.attemptId, g.history)).body;
  assert.equal(fin.wallet.starterUntil, clock + ECONOMY.starter.windowMs);
  assert.equal(fin.wallet.piggy, ECONOMY.piggy.perWin);

  const inv = (await call('POST', '/api/purchases', { product: 'starter' })).body;
  const payload = calls.find((c) => c.method === 'createInvoiceLink' && c.params.payload === inv.invoiceId)!.params.payload;
  await chat.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, successful_payment: {
    currency: 'XTR', total_amount: 50, invoice_payload: payload, telegram_payment_charge_id: 'ch-s' } } });
  const me = (await call('GET', '/api/me')).body;
  assert.equal(me.wallet.crystals, 30);
  assert.equal(me.wallet.items.hammer, 4);
  assert.equal(me.wallet.starterUntil, null, 'bought — no longer offered');
  assert.equal(me.lives.infiniteUntil, clock + ECONOMY.starter.infiniteLivesMs);
  assert.equal((await call('POST', '/api/purchases', { product: 'starter' })).status, 409);

  const pig = (await call('POST', '/api/purchases', { product: 'piggy' })).body;
  await chat.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, successful_payment: {
    currency: 'XTR', total_amount: 150, invoice_payload: pig.invoiceId, telegram_payment_charge_id: 'ch-p' } } });
  const after = (await call('GET', '/api/me')).body.wallet;
  assert.equal(after.crystals, 30 + ECONOMY.piggy.perWin);
  assert.equal(after.piggy, 0);
});

test('chat ranking marks scores made with boosters', async () => {
  const { roomId } = (await call('POST', '/api/rooms', { mode: 'challenge' })).body;
  const s = (await call('POST', `/api/rooms/${roomId}/attempts`, { boosters: ['rainbow'] })).body;
  const g = new Match3Game(optionsOf(s, ['rainbow']));
  playOut(g);
  clock += g.history.length * MIN_MS_PER_MOVE + 1000;
  assert.equal((await finish(s.attemptId, g.history)).status, 200);
  const view = (await call('GET', `/api/rooms/${roomId}`)).body;
  assert.equal(view.top[0].boosted, true);
  const room = (await store.getRoom(roomId))!;
  assert.match(chat.cardText(room, view), /⚡/);
});
