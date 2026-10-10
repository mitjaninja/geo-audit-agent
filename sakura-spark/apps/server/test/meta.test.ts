import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { createApp } from '../src/http.ts';
import { CALENDAR, calendarReward, CARDS, dailyTasks, dayNumber, TASK_KINDS, WHEEL, wheelPrize } from '../src/meta.ts';
import { GameService } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

// ---------- чистые функции ----------

test('daily tasks: three different kinds, stable for a player and a day, change between days', () => {
  const a = dailyTasks(7, 100);
  assert.equal(new Set(a.map((t) => t.kind)).size, 3);
  assert.deepEqual(dailyTasks(7, 100), a);
  assert.ok(a.every((t) => TASK_KINDS.includes(t.kind) && t.target > 0 && t.progress === 0 && !t.claimed));
  const days = new Set([...Array(20).keys()].map((d) => dailyTasks(7, 100 + d).map((t) => t.kind).join()));
  assert.ok(days.size > 5);
});

test('game day changes at midnight of the offset time zone', () => {
  const midnightMsk = Date.UTC(2026, 9, 10, 21, 0, 0); // 00:00 11 октября по Москве
  assert.equal(dayNumber(midnightMsk - 1, 3) + 1, dayNumber(midnightMsk, 3));
  assert.equal(dayNumber(midnightMsk - 1, 0), dayNumber(midnightMsk, 0));
});

test('calendar: 7-day cycle, a character card every 7th day, crystals once all cards are owned', () => {
  assert.deepEqual(calendarReward(1, {}), CALENDAR[0]);
  assert.deepEqual(calendarReward(8, {}), CALENDAR[0]);
  assert.equal(calendarReward(7, {}).card, CARDS[0].id);
  assert.equal(calendarReward(14, {}).card, CARDS[1].id);
  const all = Object.fromEntries(CARDS.map((c) => [c.id, 1]));
  const after = calendarReward(7 * (CARDS.length + 1), all);
  assert.equal(after.card, undefined);
  assert.equal(after.crystals, 3);
});

test('wheel: weights are percentages (sum 100) and every prize is reachable', () => {
  assert.equal(WHEEL.reduce((s, p) => s + p.weight, 0), 100);
  const hit = new Set<number>();
  for (let i = 0; i < 1000; i++) hit.add(wheelPrize(i / 1000));
  assert.equal(hit.size, WHEEL.length);
  assert.equal(wheelPrize(0), 0);
  assert.equal(wheelPrize(0.99999), WHEEL.length - 1);
  // ожидание бесплатных кристаллов с ежедневного спина — в бюджете PRD (2–5 в неделю вместе с календарём)
  const perSpin = WHEEL.reduce((s, p) => s + (p.weight / 100) * (p.reward.crystals ?? 0), 0);
  assert.ok(perSpin * 7 + 2 <= 5, `${perSpin * 7 + 2} crystals a week`);
});

// ---------- API ----------

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([...Array(20).keys()].map((i) => [i + 1, parseLevel({ ...base, id: i + 1, moves: 10, goals: [{ type: 'score', target: 1 }] })]));
const DAY = 86_400_000;
let clock = Date.UTC(2026, 9, 10, 9, 0, 0);
let rand = 0;
let store: SqliteStore;
let server: ReturnType<typeof createApp>;
let url: string;

beforeEach(async () => {
  store?.close();
  server?.close();
  clock = Date.UTC(2026, 9, 10, 9, 0, 0);
  store = new SqliteStore(':memory:');
  let seq = 0;
  const service = new GameService({ store, levels: LEVELS, now: () => clock, newSeed: () => 1000 + seq, newId: () => `att-${++seq}`, random: () => rand });
  server = createApp({ service, botToken: '1:t', devAuth: true, now: () => clock });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

async function win(levelId: number, user = 1) {
  const s = (await call('POST', '/api/attempts', { levelId }, user)).body;
  const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
  return (await call('POST', `/api/attempts/${s.attemptId}/finish`, { swaps: g.history }, user)).body;
}

test('login calendar: one reward per game day, a missed day does not reset the cycle, day 7 gives a card', async () => {
  const first = await call('POST', '/api/meta/login');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.reward, CALENDAR[0]);
  assert.equal(first.body.wallet.items.shuffle, 4);
  assert.equal(first.body.meta.login.claimedToday, true);
  assert.equal((await call('POST', '/api/meta/login')).status, 409);
  clock += 3 * DAY; // пропуск дней
  const second = await call('POST', '/api/meta/login');
  assert.ok(second.body.lives.infiniteUntil > clock, 'day 2: infinite lives');
  for (let i = 3; i <= 7; i++) {
    clock += DAY;
    const r = await call('POST', '/api/meta/login');
    if (i === 7) {
      assert.equal(r.body.reward.card, CARDS[0].id);
      assert.deepEqual(r.body.meta.cards, { [CARDS[0].id]: 1 });
      assert.equal(r.body.meta.login.position, 7);
    }
  }
  clock += DAY;
  const next = (await call('GET', '/api/meta')).body;
  assert.equal(next.login.position, 0, 'a new week starts');
  assert.equal(next.login.rewards[6].card, CARDS[1].id);
});

test('daily tasks: progress from games, claim when done, once; they expire with the day', async () => {
  const before = (await call('GET', '/api/meta')).body.tasks;
  assert.equal(before.length, 3);
  for (let l = 1; l <= 4; l++) await win(l);
  await call('POST', '/api/attempts', { levelId: 5, boosters: ['beamBomb', 'rainbow'] }); // бустеры
  const tasks = (await call('GET', '/api/meta')).body.tasks as any[];
  for (const t of tasks) {
    if (t.kind === 'win' || t.kind === 'booster') assert.equal(t.progress, t.target, t.kind);
    if (t.kind === 'room') assert.equal(t.progress, 0);
  }
  const done = tasks.findIndex((t: any) => t.progress >= t.target);
  if (done >= 0) {
    const r = await call('POST', '/api/meta/tasks', { slot: done });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.meta.tasks[done].claimed, true);
    assert.equal((await call('POST', '/api/meta/tasks', { slot: done })).status, 409);
  }
  const undone = tasks.findIndex((t: any) => t.progress < t.target);
  if (undone >= 0) assert.equal((await call('POST', '/api/meta/tasks', { slot: undone })).body.error, 'not_done');
  assert.equal((await call('POST', '/api/meta/tasks', { slot: 3 })).status, 400);
  clock += DAY;
  assert.ok(((await call('GET', '/api/meta')).body.tasks as any[]).every((t) => t.progress === 0 && !t.claimed));
});

test('episode chests open at 30 and 45 stars, once each', async () => {
  await win(1);
  const db = (store as any).db;
  for (let l = 1; l <= 15; l++) db.prepare('INSERT OR REPLACE INTO level_progress (user_id, level_id, best_score, stars, wins) VALUES (1, ?, 1, ?, 1)').run(l, l <= 10 ? 3 : 0);
  db.prepare('UPDATE users SET max_level = 16 WHERE id = 1').run();
  let meta = (await call('GET', '/api/meta')).body;
  assert.equal(meta.chests.length, 2, 'episode 2 is reached');
  assert.equal(meta.chests[0].stars, 30);
  assert.deepEqual(meta.chests[0].tiers.map((t: any) => t.available), [true, false]);
  assert.equal((await call('POST', '/api/meta/chests', { episode: 1, tier: 45 })).body.error, 'not_done');
  const r = await call('POST', '/api/meta/chests', { episode: 1, tier: 30 });
  assert.equal(r.status, 200);
  assert.equal(r.body.wallet.crystals, 2);
  assert.equal((await call('POST', '/api/meta/chests', { episode: 1, tier: 30 })).body.error, 'already');
  assert.equal((await call('POST', '/api/meta/chests', { episode: 1, tier: 31 })).status, 400);
  meta = r.body.meta;
  assert.equal(meta.chests[0].tiers[0].claimed, true);
});

test('wheel: a free spin a day, then up to 3 paid spins for crystals; next day free again', async () => {
  rand = 0.995; // 10 кристаллов
  const free = await call('POST', '/api/meta/wheel');
  assert.equal(free.status, 200);
  assert.equal(free.body.prize, 'crystals10');
  assert.equal(free.body.wallet.crystals, 10);
  assert.equal(free.body.meta.wheel.free, false);
  rand = 0;
  const paid = await call('POST', '/api/meta/wheel');
  assert.equal(paid.body.wallet.crystals, 1, 'paid 9');
  assert.equal(paid.body.wallet.items.hammer, 4);
  assert.equal((await call('POST', '/api/meta/wheel')).status, 402);
  await store.transact(1, (w) => ({ crystals: w.crystals + 100 }));
  assert.equal((await call('POST', '/api/meta/wheel')).status, 200);
  const third = await call('POST', '/api/meta/wheel');
  assert.equal(third.body.meta.wheel.extraLeft, 0);
  assert.equal((await call('POST', '/api/meta/wheel')).body.error, 'limit');
  clock += DAY;
  assert.equal((await call('GET', '/api/meta')).body.wheel.free, true);
  const events = (await store.getEvents(1)).filter((e) => e.name === 'wheel_spin');
  assert.deepEqual(events.map((e) => e.props.paid), [0, 9, 9, 9]);
});

test('stuck on the last level for 3 days: a free booster, once per level', async () => {
  await win(1);
  assert.equal((await call('GET', '/api/meta')).body.stuck, null);
  clock += 3 * DAY;
  const meta = (await call('GET', '/api/meta')).body;
  assert.equal(meta.stuck.levelId, 2);
  const r = await call('POST', '/api/meta/stuck');
  assert.equal(r.status, 200);
  assert.equal(r.body.wallet.items.hammer, 4);
  assert.equal(r.body.meta.stuck, null);
  assert.equal((await call('POST', '/api/meta/stuck')).status, 409);
  await win(2);
  clock += 3 * DAY;
  assert.equal((await call('GET', '/api/meta')).body.stuck.levelId, 3, 'next level — help again after 3 days');
});

test('meta settings come from remote config', async () => {
  const service = new GameService({ store, levels: LEVELS, now: () => clock, random: () => 0 });
  await service.login({ id: 2, firstName: 'B' } as any);
  await service.setConfig(JSON.stringify({ economy: { meta: { wheelSpinPrice: 3, wheelExtraSpins: 1 } } }), null);
  await store.transact(2, () => ({ crystals: 10 }));
  await service.spinWheel(2);
  const paid = await service.spinWheel(2);
  assert.equal(paid.wallet.crystals, 7);
  await assert.rejects(service.spinWheel(2), /limit/);
});
