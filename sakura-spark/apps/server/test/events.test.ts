import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { GameService } from '../src/service.ts';
import type { StartResponse } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([...Array(30).keys()].map((i) => [i + 1, parseLevel({ ...base, id: i + 1, moves: 10, goals: [{ type: 'score', target: 1 }] })]));
LEVELS.set(31, parseLevel({ ...base, id: 31, moves: 2, goals: [{ type: 'collect', color: 0, count: 500 }] }));
const HOUR = 3600_000;

let clock = Date.UTC(2026, 9, 10, 9, 0, 0);
let store: SqliteStore;
let service: GameService;

beforeEach(async () => {
  store?.close();
  clock = Date.UTC(2026, 9, 10, 9, 0, 0);
  store = new SqliteStore(':memory:');
  let seq = 0;
  service = new GameService({ store, levels: LEVELS, now: () => clock, newSeed: () => 3000 + seq, newId: () => `att-${++seq}` });
  for (let id = 1; id <= 8; id++) await service.login({ id, firstName: `P${id}` });
});

/** Партия ровно как у клиента: с бустерами старта, которые выдал сервер. */
function play(s: StartResponse): Match3Game {
  const sb = s.startBoosters;
  const g = new Match3Game({
    ...gameOptionsFromLevel(s.level, s.seed),
    ...(sb.length ? { startBoosters: { beamBomb: sb.includes('beamBomb'), rainbow: sb.includes('rainbow'), extraMoves: sb.includes('extraMoves') } } : {}),
  });
  while (g.status === 'playing') g.swap(g.validSwaps()[0]!);
  return g;
}
async function win(user: number, levelId: number, boosters: string[] = []) {
  const s = await service.startAttempt(user, levelId, boosters);
  const g = play(s);
  return { start: s, finish: await service.finishAttempt(user, s.attemptId, g.history, false) };
}
const setMax = (u: number, n: number) => (store as any).db.prepare('UPDATE users SET max_level = ? WHERE id = ?').run(n, u);
const items = async (u: number) => (await store.getWallet(u)).items;

test('win streak: free start boosters grow with wins, chosen extras are paid, a loss resets it', async () => {
  const first = await win(1, 1);
  assert.equal(first.start.streak, 0);
  assert.deepEqual(first.start.freeBoosters, []);
  const second = await win(1, 2);
  assert.deepEqual(second.start.freeBoosters, ['beamBomb']);
  assert.deepEqual(second.start.startBoosters, ['beamBomb']);
  assert.equal((await items(1)).beamBomb, 3, 'free booster is not taken from the stock');
  const third = await win(1, 3, ['beamBomb', 'extraMoves']);
  assert.deepEqual(third.start.startBoosters, ['beamBomb', 'rainbow', 'extraMoves']);
  assert.equal((await items(1)).extraMoves, 2, 'extra chosen beyond the streak is paid');
  assert.equal((await items(1)).beamBomb, 3);
  assert.equal(third.finish.result, 'won', 'replay with streak boosters matches');
  const fourth = await service.startAttempt(1, 4);
  assert.equal(fourth.streak, 3);
  // брошенная партия — поражение: серия сгорает
  const fifth = await service.startAttempt(1, 4);
  assert.equal(fifth.streak, 0);
  assert.deepEqual(fifth.freeBoosters, []);
});

test('win streak can be switched off in remote config', async () => {
  await service.setConfig(JSON.stringify({ economy: { events: { winStreak: 0 } } }), null);
  await win(2, 1);
  const s = await service.startAttempt(2, 2);
  assert.equal(s.streak, 0);
  assert.deepEqual(s.startBoosters, []);
});

test('lantern race: groups of 5 formed within an hour, new levels move the lantern, top 3 get prizes once', async () => {
  for (let u = 1; u <= 6; u++) setMax(u, 1);
  assert.equal((await service.raceView(1)).race, null);
  assert.equal((await service.raceView(1)).canJoin, true);
  for (let u = 1; u <= 5; u++) await service.joinRace(u);
  const sixth = await service.joinRace(6);
  assert.equal(sixth.race!.members.length, 1, 'the sixth player opens a new group');
  const view = await service.raceView(1);
  assert.equal(view.race!.members.length, 5);
  assert.equal(view.race!.gathering, true);
  assert.equal(view.canJoin, false);
  await assert.rejects(service.joinRace(1), /not_available/);

  // повтор пройденного уровня фонарик не двигает
  await win(1, 1);
  await win(1, 1);
  assert.equal((await service.raceView(1)).race!.members.find((m) => m.me)!.progress, 1);

  // P1 и P2 проходят 10 новых уровней
  const crystals = async (u: number) => (await store.getWallet(u)).crystals;
  for (let l = 2; l <= 10; l++) await win(1, l);
  for (let l = 1; l <= 10; l++) await win(2, l);
  let r = (await service.raceView(2)).race!;
  assert.deepEqual(r.members.slice(0, 2).map((m) => [m.name, m.place]), [['P1', 1], ['P2', 2]]);
  assert.equal(await crystals(1), 10);
  assert.equal(await crystals(2), 5);
  assert.equal((await items(1)).rainbow >= 4, true, 'the winner also gets a rainbow');
  await win(1, 11);
  assert.equal(await crystals(1), 10, 'a finished racer gets nothing more');
  // после конца гонки — итог виден, пока не просмотрен; потом можно в новую
  clock += 73 * HOUR;
  r = (await service.raceView(1)).race!;
  assert.equal(r.ended, true);
  await service.raceSeen(1);
  assert.equal((await service.raceView(1)).race, null);
  assert.equal((await service.raceView(1)).canJoin, true);
  // группа старше часа больше не набирает
  setMax(7, 1);
  assert.notEqual((await service.joinRace(7)).race!.members.length, 2);
});

test('lantern race: not offered when fewer than 10 levels are left', async () => {
  setMax(8, 25);
  assert.equal((await service.raceView(8)).canJoin, false);
});
