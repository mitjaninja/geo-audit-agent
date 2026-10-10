import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { BotApi } from '../src/bot.ts';
import { ChatBot } from '../src/chat.ts';
import { activeFestival, CARD_SETS, FESTIVALS, PASS_TIERS, seasonOf, SEASON_EPOCH } from '../src/season.ts';
import { GameService, ServiceError } from '../src/service.ts';
import type { StartResponse } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';
import { NO_STREAK } from './helpers.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2000, 3000] };
const LEVELS = new Map<number, LevelDef>([...Array(80).keys()].map((i) => [i + 1, parseLevel({ ...base, id: i + 1, moves: 10, goals: [{ type: 'score', target: 1 }] })]));
const DAY = 86_400_000;
const msk = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h - 3);

let clock = msk(2026, 10, 10);
let rand = 0.5;
let store: SqliteStore;
let service: GameService;

beforeEach(async () => {
  store?.close();
  clock = msk(2026, 10, 10);
  rand = 0.5;
  store = new SqliteStore(':memory:');
  let seq = 0;
  service = new GameService({ store, levels: LEVELS, economy: NO_STREAK, now: () => clock, newSeed: () => 500 + seq, newId: () => `att-${++seq}`, random: () => rand });
  await service.login({ id: 1, firstName: 'Мика' });
});

function play(s: StartResponse): Match3Game {
  const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
  return g;
}
async function win(levelId: number, user = 1) {
  const s = await service.startAttempt(user, levelId);
  return service.finishAttempt(user, s.attemptId, play(s).history, false);
}

test('seasons are 30 days from 1 January (Moscow); festivals follow the calendar', () => {
  assert.equal(seasonOf(SEASON_EPOCH).index, 0);
  assert.equal(seasonOf(SEASON_EPOCH + 30 * DAY - 1).index, 0);
  assert.equal(seasonOf(SEASON_EPOCH + 30 * DAY).index, 1);
  assert.equal(activeFestival(msk(2026, 10, 10)), null);
  assert.equal(activeFestival(msk(2026, 10, 30))!.festival.id, 'halloween');
  const ny = activeFestival(msk(2027, 1, 5))!;
  assert.equal(ny.festival.id, 'newyear');
  assert.equal(ny.endsAt, msk(2027, 1, 9, 0));
  assert.equal(activeFestival(msk(2026, 12, 28))!.endsAt, msk(2027, 1, 9, 0), 'new year festival crosses the year');
  assert.equal(activeFestival(msk(2026, 10, 10), 'tanabata')!.festival.id, 'tanabata');
  assert.equal(activeFestival(msk(2026, 10, 30), 'off'), null);
  assert.equal(PASS_TIERS.length, 30);
  const freeCrystals = PASS_TIERS.reduce((s, t) => s + (t.free.crystals ?? 0), 0);
  assert.ok(freeCrystals <= 10, `free track crystals in a month: ${freeCrystals}`);
});

test('pass: wins give points, tiers are claimed once; premium needs the Stars subscription; renewals and refund', async () => {
  for (let l = 1; l <= 3; l++) await win(l);
  let season = await service.seasonView(1);
  assert.ok(season.pass.points >= 3);
  assert.equal(season.pass.premium, false);
  const got = await service.claimPass(1, 1, 'free');
  assert.deepEqual(got.reward, PASS_TIERS[0]!.free);
  await assert.rejects(service.claimPass(1, 1, 'free'), (e: unknown) => e instanceof ServiceError && e.code === 'already');
  await assert.rejects(service.claimPass(1, 1, 'premium'), (e: unknown) => e instanceof ServiceError && e.code === 'not_available');
  await assert.rejects(service.claimPass(1, 30, 'free'), (e: unknown) => e instanceof ServiceError && e.code === 'not_done');

  const inv = await service.createInvoice(1, 'pass');
  assert.equal(inv.stars, 200);
  assert.equal(await service.preCheckout(inv.invoiceId, 1, 'XTR', 200), null);
  assert.equal(await service.completePayment('ch-1', inv.invoiceId, 1, 200), 'ok');
  season = await service.seasonView(1);
  assert.equal(season.pass.premium, true);
  assert.equal(season.pass.passUntil, clock + 30 * DAY);
  await service.claimPass(1, 1, 'premium');
  // продление подписки: тот же счёт, новый платёж
  clock += 29 * DAY;
  assert.equal(await service.completePayment('ch-2', inv.invoiceId, 1, 200), 'ok');
  assert.equal((await service.seasonView(1)).pass.passUntil, clock - 29 * DAY + 60 * DAY);
  await service.refund('ch-2');
  assert.equal((await service.seasonView(1)).pass.premium, false);
});

test('pass invoice is a Stars subscription', async () => {
  const calls: any[] = [];
  const api = new BotApi('1:t', (async (_: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true, result: 'https://t.me/$x' }));
  }) as typeof fetch);
  const chat = new ChatBot({ api, service, webAppUrl: 'https://g/', botUsername: 'b', directLinks: true });
  await chat.invoiceLink({ ...(await service.createInvoice(1, 'pass')) });
  await chat.invoiceLink({ ...(await service.createInvoice(1, 'pack10')) });
  assert.equal(calls[0].subscription_period, 2_592_000);
  assert.equal(calls[1].subscription_period, undefined);
});

test('collection: cards drop from wins; a full set gives a frame that can be worn', async () => {
  rand = 0.001; // карточка выпадает
  const r = await win(1);
  assert.equal(r.drop?.card, CARD_SETS[1]!.cards[0]);
  // собрать остальные карточки сета
  await store.transact(1, (w) => ({ meta: { ...w.meta, cards: Object.fromEntries(CARD_SETS[1]!.cards.slice(0, 6).map((c) => [c, 1])) } }));
  rand = 0.059; // последняя карточка сета
  const last = await win(2);
  assert.equal(last.drop?.card, CARD_SETS[1]!.cards[6]);
  const season = await service.seasonView(1);
  assert.deepEqual(season.collection.frames.map((f) => f.id), ['lantern']);
  assert.deepEqual(await service.setFrame(1, 'lantern'), { frame: 'lantern' });
  await assert.rejects(service.setFrame(1, 'gold'), (e: unknown) => e instanceof ServiceError && e.code === 'not_available');
  assert.deepEqual(await service.setFrame(1, null), { frame: null });
  rand = 0.5;
  assert.equal((await win(3)).drop, undefined);
});

test('festival: five levels in order while it lasts; the last gives its card and frame; the map does not move', async () => {
  assert.equal(await service.festivalView(1), null);
  await service.setConfig(JSON.stringify({ festival: 'halloween' }), null);
  const f = (await service.festivalView(1))!;
  assert.equal(f.levels.length, 5);
  const halloween = FESTIVALS.find((x) => x.id === 'halloween')!;
  await assert.rejects(service.startAttempt(1, f.levels[1]!), (e: unknown) => e instanceof ServiceError && e.code === 'level_locked');
  const s = await service.startAttempt(1, f.levels[0]!);
  assert.equal(s.level.intro?.[0]?.text, halloween.intro);
  await service.finishAttempt(1, s.attemptId, play(s).history, false);
  for (const id of f.levels.slice(1)) await win(id);
  const after = (await service.seasonView(1)).festival!;
  assert.equal(after.done, 5);
  const w = await store.getWallet(1);
  assert.equal(w.meta.cards?.[halloween.card], 1);
  assert.ok(w.meta.frames?.includes('halloween'));
  assert.equal((await store.getUser(1))!.maxLevel, 1, 'festival levels are off the map');
  await assert.rejects(service.startAttempt(1, f.levels[0]!), (e: unknown) => e instanceof ServiceError && e.code === 'level_locked');
});
