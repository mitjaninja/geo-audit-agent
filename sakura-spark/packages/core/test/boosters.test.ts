import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findMatches, Match3Game, Rng, START_EXTRA_MOVES } from '../src/index.ts';
import type { GameOptions, Move } from '../src/index.ts';

const at = (row: number, col: number) => ({ row, col });
/** Поле без матчей: цвета идут диагоналями. */
const BASE = ['01234', '12340', '23401', '34012', '40123'];
const opts = (over: Partial<GameOptions> = {}): GameOptions => ({ width: 5, height: 5, colors: 5, moves: 10, seed: 1, layout: BASE, ...over });
/** Сгенерированное поле (без заданной раскладки). */
const free = (over: Partial<GameOptions> = {}): GameOptions => ({ width: 7, height: 7, colors: 5, moves: 10, seed: 1, ...over });

test('hammer removes one piece without spending a move', () => {
  const g = new Match3Game(opts());
  const id = g.board.get(at(2, 2))!.id;
  const r = g.useBooster({ booster: 'hammer', at: at(2, 2) });
  assert.equal(r.valid, true);
  assert.deepEqual(r.events[0], { type: 'booster', booster: 'hammer', at: at(2, 2) });
  const step = r.events.find((e) => e.type === 'cascade');
  assert.ok(step?.type === 'cascade' && step.step.cleared.some((p) => p.row === 2 && p.col === 2));
  assert.equal(g.movesLeft, 10);
  assert.ok(!g.board.grid.flat().some((p) => p?.id === id));
  assert.deepEqual(findMatches(g.board), []);
});

test('hammer on a special fires it; on a blocker it hits the blocker; lanterns are immune', () => {
  const special = new Match3Game(opts({ layout: ['01234', '12340', '2340h1', '34012', '40123'] }));
  // в раскладке нет ходов — ядро перемешает поле при старте, поэтому луч ищем там, где он оказался
  const beam = special.board.playableCells().find((p) => special.board.get(p)?.special === 'lineH')!;
  const r = special.useBooster({ booster: 'hammer', at: beam });
  const step = r.events.find((e) => e.type === 'cascade');
  assert.ok(step?.type === 'cascade');
  assert.deepEqual(step.step.activations, [{ at: beam, special: 'lineH' }]);
  assert.equal(step.step.cleared.filter((p) => p.row === beam.row).length, 5, 'the beam cleared the row');

  const iced = new Match3Game(opts({ layout: ['01234', '12340', '23.01', '34012', '40123'], blockers: ['.....', '.....', '..I..', '.....', '.....'] }));
  const hit = iced.useBooster({ booster: 'hammer', at: at(2, 2) }).events.find((e) => e.type === 'cascade');
  assert.ok(hit?.type === 'cascade');
  assert.deepEqual(hit.step.blockersHit, [{ at: at(2, 2), kind: 'ice', layersLeft: 1 }]);

  const lantern = new Match3Game(opts({ layout: ['01234', '12340', '23L01', '34012', '40123'] }));
  const lanternAt = lantern.board.playableCells().find((p) => lantern.board.get(p)?.special === 'lantern')!;
  assert.equal(lantern.useBooster({ booster: 'hammer', at: lanternAt }).valid, false);
  assert.equal(lantern.history.length, 0);
});

test('free swap needs no match; with two specials it is a combo', () => {
  const g = new Match3Game(opts());
  const before = g.board.get(at(0, 0))!.id;
  const r = g.useBooster({ booster: 'freeSwap', a: at(0, 0), b: at(0, 1) });
  assert.equal(r.valid, true);
  assert.equal(g.board.get(at(0, 1))!.id, before);
  assert.equal(g.movesLeft, 10);
  assert.equal(g.useBooster({ booster: 'freeSwap', a: at(0, 0), b: at(2, 2) }).valid, false, 'not adjacent');

  const combo = new Match3Game(opts({ layout: ['01234', '12340', '234b0b1', '34012', '40123'] }));
  const res = combo.useBooster({ booster: 'freeSwap', a: at(2, 2), b: at(2, 3) });
  const step = res.events.find((e) => e.type === 'cascade');
  assert.ok(step?.type === 'cascade' && step.step.combo === 'megaBomb');
});

test('shuffle booster rearranges the board and keeps it playable', () => {
  const g = new Match3Game(free());
  const before = g.board.toStrings().join();
  const r = g.useBooster({ booster: 'shuffle' });
  assert.equal(r.events[1]?.type, 'shuffle');
  assert.notEqual(g.board.toStrings().join(), before);
  assert.deepEqual(findMatches(g.board), []);
  assert.ok(g.validSwaps().length > 0);
});

test('+5 moves only when moves ran out on a moves level', () => {
  const g = new Match3Game(free({ moves: 2, goals: [{ type: 'collect', color: 0, count: 500 }] }));
  assert.equal(g.addMoves(5).valid, false, 'still playing');
  g.swap(g.validSwaps()[0]!);
  g.swap(g.validSwaps()[0]!);
  assert.equal(g.status, 'lost');
  const r = g.addMoves(5);
  assert.equal(r.valid, true);
  assert.equal(g.status, 'playing');
  assert.equal(g.movesLeft, 5);
  assert.equal(g.extraMovesBought, 1);
  const timed = new Match3Game(free({ moves: 1, timeLimit: 60, goals: [{ type: 'collect', color: 0, count: 500 }] }));
  timed.swap(timed.validSwaps()[0]!);
  assert.equal(timed.addMoves(5).valid, false);
});

test('boosters are not allowed after the game is over; a win from a booster counts', () => {
  const g = new Match3Game(opts({ goals: [{ type: 'score', target: 1 }] }));
  const r = g.useBooster({ booster: 'hammer', at: at(0, 0) });
  assert.equal(g.status, 'won', 'clearing with the hammer reached the score goal');
  assert.ok(r.events.some((e) => e.type === 'finale'));
  assert.equal(g.useBooster({ booster: 'shuffle' }).valid, false);
});

test('start boosters: beam + bomb, rainbow and +3 moves, deterministic by seed', () => {
  const o = free({ width: 8, height: 8, seed: 42, startBoosters: { beamBomb: true, rainbow: true, extraMoves: true } });
  const g = new Match3Game(o);
  const specials = g.board.grid.flat().map((p) => p?.special).filter((s) => s && s !== 'none').sort();
  assert.equal(specials.length, 3);
  assert.ok(specials.includes('bomb') && specials.includes('rainbow'));
  assert.ok(specials.some((s) => s === 'lineH' || s === 'lineV'));
  assert.equal(g.movesLeft, 10 + START_EXTRA_MOVES);
  assert.deepEqual(new Match3Game(o).board.toStrings(), g.board.toStrings(), 'same seed — same placement');
  assert.deepEqual(findMatches(g.board), []);
});

test('replay of a mixed history (swaps, boosters, extra moves) is exact; boosters are counted', () => {
  const o = free({ moves: 6, seed: 9, goals: [{ type: 'collect', color: 0, count: 500 }] });
  const g = new Match3Game(o);
  const rng = new Rng(3);
  const step = () => {
    const s = g.validSwaps();
    g.swap(s[rng.int(s.length)]!);
  };
  step();
  g.useBooster({ booster: 'hammer', at: at(3, 3) });
  step();
  g.useBooster({ booster: 'shuffle' });
  g.useBooster({ booster: 'freeSwap', a: at(6, 0), b: at(6, 1) });
  while (g.status === 'playing') step();
  assert.equal(g.addMoves(5).valid, true);
  for (let i = 0; i < 5; i++) step();
  const copy = Match3Game.replay(o, g.history);
  assert.equal(copy.score, g.score);
  assert.deepEqual(copy.board.toStrings(), g.board.toStrings());
  assert.deepEqual(g.boostersUsed(), { hammer: 1, freeSwap: 1, shuffle: 1 });
  assert.throws(() => Match3Game.replay(o, [{ booster: 'hammer', at: at(99, 99) } as Move]), /invalid/);
});
