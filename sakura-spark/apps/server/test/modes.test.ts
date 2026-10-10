import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef, Move } from '@sakura/core';
import { CHALLENGE_ALL, DUEL_PRIZE, GameService, MIN_MS_PER_MOVE, piecesCleared, ServiceError, TEAM_CHEST } from '../src/service.ts';
import { SqliteStore } from '../src/store.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([...Array(6).keys()].map((i) => [i + 1, parseLevel({ ...base, id: i + 1, moves: 12, goals: [{ type: 'score', target: 400 }] })]));
const HOUR = 3600_000;

let clock = Date.UTC(2026, 9, 10, 9, 0, 0);
let store: SqliteStore;
let service: GameService;
const pushes: { to: number; text: string }[] = [];

beforeEach(async () => {
  store?.close();
  clock = Date.UTC(2026, 9, 10, 9, 0, 0);
  store = new SqliteStore(':memory:');
  let seq = 0;
  service = new GameService({
    store, levels: LEVELS, now: () => clock, newSeed: () => 7000 + seq, newId: () => `att-${++seq}`,
    sendPush: async (to, text) => {
      pushes.push({ to, text });
      return true;
    },
  });
  pushes.length = 0;
  for (const [id, name] of [[1, 'Мика'], [2, 'Рэн'], [3, 'Сэцу'], [4, 'Пон']] as const) await service.login({ id, firstName: name, allowsPm: true });
});

/** Сыграть в комнате: playMoves ходов (или до конца), выдержав темп «не быстрее 250 мс на ход». */
async function playRoom(roomId: string, user: number, limit = Infinity): Promise<{ moves: Move[]; result: Awaited<ReturnType<GameService['finishAttempt']>> }> {
  const s = await service.startRoomAttempt(user, roomId);
  const g = new Match3Game(gameOptionsFromLevel(s.level, s.seed));
  while (g.status === 'playing' && g.history.length < limit) g.swap(g.validSwaps()[0]!);
  clock += g.history.length * MIN_MS_PER_MOVE + 1000;
  return { moves: [...g.history], result: await service.finishAttempt(user, s.attemptId, g.history, false) };
}

const crystals = async (u: number) => (await store.getWallet(u)).crystals;
const items = async (u: number) => (await store.getWallet(u)).items;

test('team lantern: the chat lights the target together, every contributor gets the chest once', async () => {
  await service.setConfig(JSON.stringify({ economy: { chat: { teamTarget: 25 } } }), null);
  const room = await service.createRoom(1, 'team');
  assert.equal(room.expiresAt - room.createdAt, 48 * HOUR);
  const a = await playRoom(room.id, 2, 1);
  const lit = piecesCleared(gameOptionsFromLevel(LEVELS.get(room.levelId)!, room.seed), a.moves);
  let view = await service.roomView(room.id, 2);
  assert.ok(lit > 0 && lit < 25, `one move lights a few: ${lit}`);
  assert.deepEqual(view.team, { progress: lit, target: 25, reward: TEAM_CHEST });
  assert.equal(view.top[0]!.score, lit, 'ranking by contribution');
  assert.equal(view.settled, false);
  const hammerBefore = (await items(3)).hammer;
  await playRoom(room.id, 3);
  view = await service.roomView(room.id, 3);
  if (!view.settled) await playRoom(room.id, 4);
  view = await service.roomView(room.id, 3);
  assert.equal(view.settled, true);
  assert.ok(view.team!.progress >= 25);
  assert.equal(await crystals(2), 3, 'contributor 2 got the chest');
  assert.equal((await items(3)).hammer, hammerBefore + 1);
  assert.equal(await crystals(1), 0, 'the creator did not play');
  assert.ok(pushes.some((p) => p.to === 2 && /фонарь зажжён/i.test(p.text)));
  await assert.rejects(service.startRoomAttempt(1, room.id), (e: unknown) => e instanceof ServiceError && e.code === 'room_expired');
  await service.settleExpiredRooms();
  assert.equal(await crystals(2), 3, 'only once');
});

test('duel: two players, one attempt each, fewer moves wins a booster; a third player is turned away', async () => {
  const room = await service.createRoom(1, 'duel');
  assert.equal(room.expiresAt - room.createdAt, HOUR);
  const lives = (await store.getUser(1))!.lives.lives;
  const first = await playRoom(room.id, 1);
  assert.equal((await store.getUser(1))!.lives.lives, lives, 'duel is free');
  await assert.rejects(service.startRoomAttempt(1, room.id), (e: unknown) => e instanceof ServiceError && e.code === 'already');
  let view = await service.roomView(room.id, 3);
  assert.equal(view.duel!.full, false);
  assert.equal(view.duel!.winner, null);
  const second = await playRoom(room.id, 2);
  await assert.rejects(service.startRoomAttempt(3, room.id), (e: unknown) => e instanceof ServiceError && (e.code === 'duel_full' || e.code === 'room_expired'));
  view = await service.roomView(room.id, 3);
  assert.equal(view.settled, true);
  const m1 = first.result.result === 'won' ? first.moves.length : Infinity;
  const m2 = second.result.result === 'won' ? second.moves.length : Infinity;
  const winner = m1 <= m2 ? 'Мика' : 'Рэн';
  assert.equal(view.duel!.winner, winner);
  assert.equal(view.duel!.players[0]!.name, winner);
  const winnerId = winner === 'Мика' ? 1 : 2;
  assert.equal((await items(winnerId)).rainbow, 3 + DUEL_PRIZE.items!.rainbow!);
  assert.equal((await items(3 - winnerId)).rainbow, 3);
});

test('duel alone: after the hour the only player wins only if they passed the level', async () => {
  const won = await service.createRoom(1, 'duel');
  const r = await playRoom(won.id, 1);
  const lost = await service.createRoom(2, 'duel');
  await playRoom(lost.id, 2, 1); // один ход — не пройти
  clock += 2 * HOUR;
  assert.equal(await service.settleExpiredRooms(), 2);
  assert.equal((await items(1)).rainbow, r.result.result === 'won' ? 4 : 3);
  assert.equal((await items(2)).rainbow, 3);
});

test('challenge: when it ends, top 3 get crystals 5/3/2 and every player a booster', async () => {
  const room = await service.createRoom(1, 'challenge');
  for (const u of [1, 2, 3, 4]) await playRoom(room.id, u, u + 2);
  clock += 25 * HOUR;
  const view = await service.roomView(room.id, 1); // подводит итог при открытии
  assert.equal(view.settled, true);
  const order = view.top.map((t) => t.name);
  const ids: Record<string, number> = { Мика: 1, Рэн: 2, Сэцу: 3, Пон: 4 };
  assert.deepEqual(await Promise.all(order.map((n) => crystals(ids[n]!))), [5, 3, 2, 0]);
  for (const n of order) assert.equal((await items(ids[n]!)).shuffle, 3 + CHALLENGE_ALL.items!.shuffle!);
  assert.equal(await service.settleExpiredRooms(), 0);
});

test('help: a helper earns 1 crystal per gifted life, up to 3 a day', async () => {
  for (let i = 0; i < 4; i++) {
    const room = await service.createRoom(i % 2 === 0 ? 1 : 3, 'help');
    assert.equal((await service.giftLife(room.id, { id: 2, firstName: 'Рэн' })).status, 'ok');
  }
  assert.equal(await crystals(2), 3);
  clock += 24 * HOUR;
  const room = await service.createRoom(1, 'help');
  await service.giftLife(room.id, { id: 2, firstName: 'Рэн' });
  assert.equal(await crystals(2), 4, 'a new day');
});
