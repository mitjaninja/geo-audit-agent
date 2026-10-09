import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findMatches, Match3Game, POINTS_PER_PIECE, Rng, SPECIAL_BONUS } from '../src/index.ts';
import type { GameOptions } from '../src/index.ts';

const opts: GameOptions = { width: 9, height: 9, colors: 5, moves: 20, seed: 2026 };

function assertHealthy(game: Match3Game) {
  const rows = game.board.toStrings();
  assert.ok(rows.every((r) => !r.includes('.')), 'board is full');
  assert.deepEqual(findMatches(game.board), [], 'no pending matches');
  assert.ok(game.validSwaps().length > 0, 'at least one move');
}

test('new game: full board, no matches, has moves', () => {
  for (let seed = 0; seed < 200; seed++) {
    assertHealthy(new Match3Game({ ...opts, seed }));
  }
});

test('same seed gives same starting board', () => {
  assert.deepEqual(new Match3Game(opts).board.toStrings(), new Match3Game(opts).board.toStrings());
  assert.notDeepEqual(new Match3Game(opts).board.toStrings(), new Match3Game({ ...opts, seed: 1 }).board.toStrings());
});

test('rejects invalid options', () => {
  assert.throws(() => new Match3Game({ ...opts, width: 10 }));
  assert.throws(() => new Match3Game({ ...opts, colors: 3 }));
  assert.throws(() => new Match3Game({ ...opts, moves: 0 }));
});

test('invalid swap does not spend a move and bounces back', () => {
  const game = new Match3Game(opts);
  const valid = new Set(game.validSwaps().map((s) => JSON.stringify(s)));
  let bad;
  outer: for (let row = 0; row < 9; row++)
    for (let col = 0; col < 8; col++) {
      const s = { a: { row, col }, b: { row, col: col + 1 } };
      if (!valid.has(JSON.stringify(s))) { bad = s; break outer; }
    }
  assert.ok(bad);
  const before = game.board.toStrings();
  const res = game.swap(bad);
  assert.equal(res.valid, false);
  assert.deepEqual(res.events.map((e) => e.type), ['swap', 'swapBack']);
  assert.equal(game.movesLeft, opts.moves);
  assert.deepEqual(game.board.toStrings(), before);
});

test('non-adjacent swap is rejected without events', () => {
  const game = new Match3Game(opts);
  const res = game.swap({ a: { row: 0, col: 0 }, b: { row: 4, col: 4 } });
  assert.deepEqual(res, { valid: false, events: [] });
});

test('valid swap: spends move, scores, leaves healthy board, events are consistent', () => {
  const game = new Match3Game(opts);
  const [s] = game.validSwaps();
  const res = game.swap(s!);
  assert.equal(res.valid, true);
  assert.equal(game.movesLeft, opts.moves - 1);
  assert.equal(res.events[0]?.type, 'swap');

  const cascades = res.events.flatMap((e) => (e.type === 'cascade' ? [e] : []));
  assert.ok(cascades.length >= 1);
  cascades.forEach((c, i) => {
    assert.equal(c.index, i);
    const bonus = c.step.created.reduce((sum, x) => sum + SPECIAL_BONUS[x.piece.special as 'bomb'], 0);
    assert.equal(c.step.scoreGained, c.step.cleared.length * POINTS_PER_PIECE * (i + 1) + bonus);
    assert.equal(c.step.spawns.length, c.step.cleared.length - c.step.created.length, 'every cleared cell is refilled');
    for (const f of c.step.falls) {
      assert.equal(f.from.col, f.to.col);
      assert.ok(f.to.row > f.from.row, 'pieces fall down');
    }
  });
  assert.equal(game.score, cascades.reduce((sum, c) => sum + c.step.scoreGained, 0));
  assertHealthy(game);
});

test('piece ids stay unique', () => {
  const game = new Match3Game(opts);
  for (let i = 0; i < 10; i++) game.swap(game.validSwaps()[0]!);
  const ids = game.board.grid.flat().map((p) => p!.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('game ends when moves run out', () => {
  const game = new Match3Game({ ...opts, moves: 3 });
  for (let i = 0; i < 3; i++) assert.equal(game.swap(game.validSwaps()[0]!).valid, true);
  assert.equal(game.status, 'out_of_moves');
  assert.equal(game.swap(game.validSwaps()[0]!).valid, false);
});

test('replay reproduces score and board exactly', () => {
  const rng = new Rng(99);
  const game = new Match3Game(opts);
  while (game.status === 'playing') {
    const swaps = game.validSwaps();
    game.swap(swaps[rng.int(swaps.length)]!);
  }
  const copy = Match3Game.replay(opts, game.history);
  assert.equal(copy.score, game.score);
  assert.deepEqual(copy.board.toStrings(), game.board.toStrings());
});

test('replay rejects a forged move', () => {
  assert.throws(() => Match3Game.replay(opts, [{ a: { row: 0, col: 0 }, b: { row: 5, col: 5 } }]), /invalid/);
});

test('long random sessions stay healthy (shuffle/reset paths)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const rng = new Rng(seed);
    for (const colors of [4, 6]) {
      const game = new Match3Game({ width: 6, height: 6, colors, moves: 60, seed });
      while (game.status === 'playing') {
        const swaps = game.validSwaps();
        const res = game.swap(swaps[rng.int(swaps.length)]!);
        assert.equal(res.valid, true);
      }
      assertHealthy(game);
    }
  }
});

test('dead board after a move triggers shuffle that keeps the same pieces', () => {
  let shuffles = 0;
  for (let seed = 0; seed < 50 && shuffles === 0; seed++) {
    const rng = new Rng(seed);
    const game = new Match3Game({ width: 5, height: 5, colors: 6, moves: 50, seed });
    while (game.status === 'playing') {
      const swaps = game.validSwaps();
      const res = game.swap(swaps[rng.int(swaps.length)]!);
      const shuffle = res.events.find((e) => e.type === 'shuffle');
      if (shuffle?.type !== 'shuffle') continue;
      shuffles++;
      for (const m of shuffle.moves) assert.equal(game.board.get(m.to)?.id, m.id);
      assertHealthy(game);
    }
  }
  assert.ok(shuffles > 0, 'shuffle path was exercised');
});
