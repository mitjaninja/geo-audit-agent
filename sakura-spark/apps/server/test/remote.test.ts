import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { BotApi } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { DEFAULT_ECONOMY } from '../src/economy.ts';
import { createApp } from '../src/http.ts';
import { ConfigError, parseRemoteConfig, resolveConfig, tweakLevel, variantOf } from '../src/remote.ts';
import type { Experiment } from '../src/remote.ts';
import { buildReport, formatReport } from '../src/report.ts';
import { GameService } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([
  [1, parseLevel({ ...base, id: 1, moves: 10, goals: [{ type: 'score', target: 1 }] })],
  [2, parseLevel({ ...base, id: 2, moves: 3, goals: [{ type: 'collect', color: 0, count: 500 }] })],
  [3, parseLevel({ ...base, id: 3, moves: 30, timeLimit: 60, goals: [{ type: 'score', target: 100 }] })],
]);
const IDS = new Set(LEVELS.keys());

// ---------- чистые функции ----------

test('config validation: unknown fields, wrong types and missing levels are refused with a path', () => {
  const bad: [unknown, RegExp][] = [
    [[], /ожидается объект/],
    [{ prices: {} }, /неизвестные поля prices/],
    [{ economy: { refillLives: -1 } }, /economy\.refillLives/],
    [{ economy: { refillLives: 1.5 } }, /economy\.refillLives/],
    [{ economy: { packs: { pack10: { stars: 0 } } } }, /economy\.packs\.pack10\.stars: целое от 1/],
    [{ economy: { packs: { pack7: { stars: 5 } } } }, /неизвестные поля pack7/],
    [{ economy: { itemPrices: { sword: 3 } } }, /неизвестные поля sword/],
    [{ economy: { extendPrices: [] } }, /extendPrices/],
    [{ economy: { starter: { items: { sword: 1 } } } }, /неизвестный предмет sword/],
    [{ levels: { 99: { moves: 2 } } }, /нет уровня 99/],
    [{ levels: { 1: { moves: 50 } } }, /levels\.1\.moves/],
    [{ levels: { 1: { colors: 4 } } }, /неизвестные поля colors/],
    [{ assistAfterLosses: 1 }, /assistAfterLosses/],
    [{ experiments: [{ id: 'Bad Id', active: true, variants: [] }] }, /\.id/],
    [{ experiments: [{ id: 'a', active: true, variants: [{ name: 'x', weight: 1 }] }] }, /2–5 вариантов/],
    [{ experiments: [{ id: 'a', active: true, variants: [{ name: 'x', weight: 1 }, { name: 'x', weight: 1 }] }] }, /name/],
    [{ experiments: [{ id: 'a', active: true, variants: [{ name: 'x', weight: 1 }, { name: 'y', weight: 1, config: { experiments: [] } }] }] }, /неизвестные поля experiments/],
  ];
  for (const [cfg, msg] of bad) assert.throws(() => parseRemoteConfig(cfg, IDS), (e: unknown) => e instanceof ConfigError && msg.test(e.message), JSON.stringify(cfg));
  const ok = parseRemoteConfig({
    economy: { refillLives: 10, packs: { pack10: { stars: 45 } }, starter: { items: { rainbow: 2 } } },
    levels: { 1: { moves: -2 }, 3: { time: 15 } }, assistAfterLosses: 3,
  }, IDS);
  assert.equal(ok.economy?.refillLives, 10);
});

test('variants: stable per user, roughly follow the weights', () => {
  const exp: Experiment = { id: 'price', active: true, variants: [{ name: 'a', weight: 1, config: {} }, { name: 'b', weight: 3, config: {} }] };
  assert.equal(variantOf(exp, 42).name, variantOf(exp, 42).name);
  let b = 0;
  for (let u = 1; u <= 4000; u++) if (variantOf(exp, u).name === 'b') b++;
  assert.ok(b > 2850 && b < 3150, `b = ${b} of 4000`);
  // другой эксперимент делит игроков независимо
  const other: Experiment = { ...exp, id: 'other' };
  let same = 0;
  for (let u = 1; u <= 4000; u++) if (variantOf(exp, u).name === variantOf(other, u).name) same++;
  assert.ok(same < 2800, `same = ${same}`);
});

test('resolve: base config, then active experiment variants; inactive experiments are ignored', () => {
  const cfg = parseRemoteConfig({
    economy: { refillLives: 10, itemPrices: { hammer: 12 } },
    levels: { 1: { moves: 2 } },
    experiments: [
      { id: 'all_b', active: true, variants: [{ name: 'a', weight: 1, config: {} }, { name: 'b', weight: 100, config: { economy: { refillLives: 8 }, levels: { 2: { moves: 1 } } } }] },
      { id: 'off', active: false, variants: [{ name: 'a', weight: 1, config: { assistAfterLosses: 2 } }, { name: 'b', weight: 1, config: { assistAfterLosses: 2 } }] },
    ],
  }, IDS);
  const users = [...Array(50).keys()].map((u) => resolveConfig(cfg, u + 1));
  const inB = users.filter((r) => r.variants.all_b === 'b');
  assert.ok(inB.length > 40);
  for (const r of inB) {
    assert.equal(r.economy.refillLives, 8);
    assert.equal(r.economy.itemPrices.hammer, 12, 'base layer stays');
    assert.equal(r.economy.itemPrices.rainbow, DEFAULT_ECONOMY.itemPrices.rainbow, 'defaults stay');
    assert.deepEqual(r.levels, { 1: { moves: 2 }, 2: { moves: 1 } });
    assert.equal(r.assistAfterLosses, 5);
    assert.equal(r.variants.off, undefined);
  }
  assert.equal(DEFAULT_ECONOMY.refillLives, 12, 'defaults are not mutated');
});

test('level tweaks: moves and time are shifted, with floors', () => {
  assert.deepEqual(tweakLevel(LEVELS.get(1)!, { moves: -3 }), { moves: 7, timeLimit: null });
  assert.deepEqual(tweakLevel(LEVELS.get(2)!, { moves: -3 }), { moves: 5, timeLimit: null }, 'at least 5 moves');
  assert.deepEqual(tweakLevel(LEVELS.get(1)!, { time: 10 }), { moves: null, timeLimit: null }, 'not a timed level');
  assert.deepEqual(tweakLevel(LEVELS.get(3)!, { time: -50 }), { moves: null, timeLimit: 20 });
  assert.deepEqual(tweakLevel(LEVELS.get(1)!, undefined), { moves: null, timeLimit: null });
});

// ---------- сервис, API и бот ----------

let clock = 1_760_000_000_000;
let store: SqliteStore;
let service: GameService;
let server: ReturnType<typeof createApp>;
let url: string;
let chat: ChatBot;
const sent: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const params = JSON.parse(String(init?.body));
  if (String(input).endsWith('/sendMessage')) sent.push(params.text);
  return new Response(JSON.stringify({ ok: true, result: true }));
}) as typeof fetch;

beforeEach(async () => {
  store?.close();
  server?.close();
  store = new SqliteStore(':memory:');
  let seq = 0;
  service = new GameService({ store, levels: LEVELS, now: () => clock, newSeed: () => 1000 + seq, newId: () => `att-${++seq}` });
  chat = new ChatBot({ api: new BotApi('1:t', fakeFetch), service, webAppUrl: 'https://g/', botUsername: 'b', directLinks: false, refreshDelayMs: 0, adminIds: [777],
    report: async () => formatReport(buildReport(store, await service.remoteConfig(), clock), true) + '\n' + 'x'.repeat(100).concat('\n').repeat(60),
  });
  server = createApp({
    service, botToken: '1:t', devAuth: true, now: () => clock, adminIds: [777], report: async () => buildReport(store, await service.remoteConfig(), clock),
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

const say = (text: string, from = 777) => chat.handleUpdate({ message: { chat: { id: from, type: 'private' }, from: { id: from, first_name: 'A' }, text } });

test('admin edits the config from the bot chat: set, show, refuse bad JSON, roll back; others are ignored', async () => {
  await say('/config_set {"economy":{"refillLives":10}}', 5);
  assert.deepEqual(sent, [], 'not an admin');
  await say('/myid', 5);
  assert.equal(sent.pop(), 'Твой Telegram id: 5');

  await say('/config');
  assert.match(sent.pop()!, /Конфиг пустой/);
  await say('/config_set {"economy":{"refillLives":10}}');
  assert.match(sent.pop()!, /Конфиг #1 сохранён/);
  assert.equal((await call('GET', '/api/shop')).body.refillLives, 10, 'applies without a restart');
  await say('/config_set {"economy":{"refillLives":"cheap"}}');
  assert.match(sent.pop()!, /Не сохранил: economy\.refillLives/);
  await say('/config_set {oops');
  assert.match(sent.pop()!, /Не сохранил: это не JSON/);
  await say('/config_set\n{\n "economy": {"refillLives": 7},\n "experiments": [{"id":"lives","active":true,"variants":[{"name":"a","weight":1},{"name":"b","weight":1}]}]\n}');
  assert.match(sent.pop()!, /#2 сохранён[\s\S]*lives: a 1 \/ b 1/);
  await say('/config');
  assert.match(sent.pop()!, /Конфиг #2[\s\S]*"refillLives": 7[\s\S]*История: #2 .*, #1/);
  await say('/config_rollback');
  assert.match(sent.pop()!, /Вернул версию #1, теперь это #3/);
  assert.equal((await call('GET', '/api/shop')).body.refillLives, 10);
  assert.equal((await service.configHistory()).length, 3);
});

test('level moves from the config reach the client and the replay; a config change mid-game does not break the attempt', async () => {
  await service.setConfig(JSON.stringify({ levels: { 1: { moves: -4 } } }), null);
  assert.deepEqual((await call('GET', '/api/me')).body.levelOverrides, { 1: { moves: 6 } });
  const s = (await call('POST', '/api/attempts', { levelId: 1 })).body;
  assert.equal(s.level.moves, 6);
  await service.setConfig(JSON.stringify({ levels: { 1: { moves: 10 } } }), null);
  const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
  const fin = await call('POST', `/api/attempts/${s.attemptId}/finish`, { swaps: g.history });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.equal(fin.body.result, 'won');
  const start = (await store.getEvents(1)).find((e) => e.name === 'level_start')!;
  assert.equal(start.props.moves, 6);
});

test('assist threshold from the config; experiment variants are written into events', async () => {
  await service.setConfig(JSON.stringify({
    assistAfterLosses: 2,
    experiments: [{ id: 'p', active: true, variants: [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }] }],
  }), null);
  // уровень 2 не пройти за 3 хода — две проигранные попытки
  await store.upsertUser({ id: 1, firstName: 'A' } as any, clock, { lives: 5, updatedAt: clock, infiniteUntil: 0 });
  (store as any).db.prepare('UPDATE users SET max_level = 2 WHERE id = 1').run();
  for (let i = 0; i < 2; i++) {
    const s = (await call('POST', '/api/attempts', { levelId: 2 })).body;
    assert.equal(s.assist, 0);
    const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
    while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
    await call('POST', `/api/attempts/${s.attemptId}/finish`, { swaps: g.history });
  }
  const third = (await call('POST', '/api/attempts', { levelId: 2 })).body;
  assert.ok(third.assist > 0, 'assist after 2 losses');
  const start = (await store.getEvents(1)).find((e) => e.name === 'level_start')!;
  assert.match(String((start.props.exp as Record<string, string>).p), /^[ab]$/);
});

test('a stored config that no longer fits the levels is ignored, not fatal', async () => {
  await store.saveConfig(JSON.stringify({ levels: { 99: { moves: 1 } } }), clock, null);
  const logs: string[] = [];
  const s2 = new GameService({ store, levels: LEVELS, now: () => clock, log: (m) => logs.push(m) });
  assert.equal((await s2.configFor(1)).economy.refillLives, DEFAULT_ECONOMY.refillLives);
  assert.match(logs[0]!, /ignored: levels: нет уровня 99/);
});

test('report: clean games exclude boosters; per-variant split; admins only, long text is split', async () => {
  await service.setConfig(JSON.stringify({ experiments: [{ id: 'e', active: true, variants: [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }] }] }), null);
  for (const [user, boosters] of [[1, []], [2, ['beamBomb']], [3, []]] as [number, string[]][]) {
    const s = (await call('POST', '/api/attempts', { levelId: 1, boosters }, user)).body;
    const o = gameOptionsFromLevel(s.level, s.seed);
    const g = new Match3Game(boosters.length ? { ...o, startBoosters: { beamBomb: true, rainbow: false, extraMoves: false } } : o);
    while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
    assert.equal((await call('POST', `/api/attempts/${s.attemptId}/finish`, { swaps: g.history }, user)).body.result, 'won');
  }
  assert.equal((await call('GET', '/api/admin/report', undefined, 1)).status, 403);
  const r = (await call('GET', '/api/admin/report', undefined, 777)).body;
  const l1 = r.levels.find((l: any) => l.levelId === 1);
  assert.equal(l1.wins, 3);
  assert.equal(l1.cleanGames, 2);
  assert.equal(r.experiments[0].variants.reduce((s: number, v: any) => s + v.users, 0), 4, 'three players and the admin');

  await say('/report', 5);
  assert.equal(sent.length, 0, 'not an admin');
  await say('/report');
  assert.ok(sent.length >= 2, 'split into several messages');
  assert.ok(sent.every((m) => m.length <= 4096));
  assert.match(sent[0]!, /Игроков: 4[\s\S]*Эксперимент e/);
});
