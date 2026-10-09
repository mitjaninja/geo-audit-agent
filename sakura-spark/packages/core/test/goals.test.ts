import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINALE_BONUS_PER_MOVE, Match3Game, Rng, starsFor } from '../src/index.ts';
import type { CascadeStep, GameOptions, Swap } from '../src/index.ts';

const sw = (a: [number, number], b: [number, number]): Swap => ({ a: { row: a[0], col: a[1] }, b: { row: b[0], col: b[1] } });

/** Дыра в (2,0); свап (3,2)↔(4,2) собирает 000 в ряду 3. */
const HOLE_ROWS = ['12345', '23451', '_4512', '00234', '34051'];
const base: GameOptions = { width: 5, height: 5, colors: 6, moves: 10, seed: 3, layout: HOLE_ROWS };

function firstStep(game: Match3Game, swap: Swap) {
  const res = game.swap(swap);
  assert.equal(res.valid, true);
  const e = res.events.find((x) => x.type === 'cascade');
  assert.ok(e?.type === 'cascade');
  return { step: e.step as CascadeStep, events: res.events };
}

test('starsFor', () => {
  const t = [100, 200, 300] as const;
  assert.equal(starsFor(50, t, true), 1, 'a win always gives one star');
  assert.equal(starsFor(250, t, true), 2);
  assert.equal(starsFor(999, t, true), 3);
  assert.equal(starsFor(999, t, false), 0);
});

test('pieces fall through holes, holes stay empty', () => {
  const game = new Match3Game(base);
  const { step } = firstStep(game, sw([3, 2], [4, 2]));
  assert.ok(step.falls.some((f) => f.from.row === 1 && f.from.col === 0 && f.to.row === 3 && f.to.col === 0),
    'piece from row 1 jumped over the hole to row 3');
  const rng = new Rng(1);
  while (game.status === 'playing') {
    const s = game.validSwaps();
    game.swap(s[rng.int(s.length)]!);
    assert.equal(game.board.get({ row: 2, col: 0 }), null);
    assert.equal(game.board.toStrings()[2]![0], '_');
  }
});

test('shape option makes holes on a generated board', () => {
  const shape = ['_###_', '#####', '#####', '#####', '_###_'];
  const game = new Match3Game({ width: 5, height: 5, colors: 5, moves: 5, seed: 1, shape });
  const rows = game.board.toStrings();
  for (const [r, c] of [[0, 0], [0, 4], [4, 0], [4, 4]] as const) assert.equal(rows[r]![c], '_');
  assert.equal(rows.join('').replaceAll('_', '').length, 21);
  assert.ok(!rows.join('').includes('.'));
});

test('jelly loses a layer when a piece above it is cleared', () => {
  const jelly = ['_0000', '00000', '_0000', '21000', '00000'];
  const game = new Match3Game({ ...base, jelly, goals: [{ type: 'jelly' }] });
  const { step } = firstStep(game, sw([3, 2], [4, 2]));
  assert.ok(step.jellyHit.some((p) => p.row === 3 && p.col === 0));
  assert.ok(step.jellyHit.some((p) => p.row === 3 && p.col === 1));
  assert.equal(game.jellyAt({ row: 3, col: 1 }), 0);
  assert.ok(game.jellyAt({ row: 3, col: 0 }) <= 1);
  const [progress] = game.goalProgress();
  assert.equal(progress?.target, 3);
  assert.ok(progress!.current >= 2);
});

test('jelly on a hole is rejected', () => {
  assert.throws(() => new Match3Game({ ...base, jelly: ['00000', '00000', '10000', '00000', '00000'] }), /hole/);
});

test('clearing the last jelly wins and turns moves left into finale bonus', () => {
  const jelly = ['_0000', '00000', '_0000', '01000', '00000'];
  const game = new Match3Game({ ...base, jelly, goals: [{ type: 'jelly' }], stars: [100, 900, 5000] });
  const { events } = firstStep(game, sw([3, 2], [4, 2]));
  assert.equal(game.status, 'won');
  const finale = events.at(-1);
  assert.deepEqual(finale, { type: 'finale', movesLeft: 9, bonus: 9 * FINALE_BONUS_PER_MOVE });
  assert.equal(game.score, 3 * 20 + 9 * FINALE_BONUS_PER_MOVE);
  assert.equal(game.stars, 2);
  assert.deepEqual(game.swap(game.validSwaps()[0]!), { valid: false, events: [] }, 'no moves after a win');
});

test('collect goal counts cleared pieces of a color', () => {
  const game = new Match3Game({ ...base, goals: [{ type: 'collect', color: 0, count: 3 }] });
  firstStep(game, sw([3, 2], [4, 2]));
  assert.equal(game.status, 'won');
  assert.deepEqual(game.goalProgress().map((g) => [g.current, g.target, g.done]), [[3, 3, true]]);
});

test('all goals must be done to win', () => {
  const game = new Match3Game({ ...base, goals: [{ type: 'score', target: 1 }, { type: 'collect', color: 0, count: 500 }] });
  firstStep(game, sw([3, 2], [4, 2]));
  assert.equal(game.status, 'playing');
  assert.deepEqual(game.goalProgress().map((g) => g.done), [true, false]);
});

test('running out of moves with goals left is a loss with zero stars', () => {
  const game = new Match3Game({ ...base, moves: 2, goals: [{ type: 'collect', color: 0, count: 500 }], stars: [1, 2, 3] });
  game.swap(game.validSwaps()[0]!);
  game.swap(game.validSwaps()[0]!);
  assert.equal(game.status, 'lost');
  assert.equal(game.stars, 0);
});

test('without goals the game never wins', () => {
  const game = new Match3Game({ ...base, moves: 3 });
  for (let i = 0; i < 3; i++) game.swap(game.validSwaps()[0]!);
  assert.equal(game.status, 'lost');
});

const LANTERN_ROWS = ['23450', '34502', '45023', '021L4', '11312'];

test('lantern reaching the bottom is collected and counts for the goal', () => {
  const game = new Match3Game({
    width: 5, height: 5, colors: 6, moves: 10, seed: 1, layout: LANTERN_ROWS,
    lanterns: { total: 1, maxOnBoard: 1, spawnChance: 1 }, goals: [{ type: 'lanterns', count: 1 }],
  });
  const lanternId = game.board.get({ row: 3, col: 3 })!.id;
  const { step } = firstStep(game, sw([3, 2], [4, 2]));
  assert.deepEqual(step.lanternsCollected, [{ id: lanternId, at: { row: 4, col: 3 } }]);
  assert.equal(game.status, 'won');
  assert.ok(!game.board.toStrings().join('').includes('L'), 'total reached — no new lanterns');
});

test('lanterns are immune to blasts', () => {
  // бомбы в (3,2) и (3,3), фонарик прямо над ними в (2,2)
  const fixed = ['01234', '12345', '23L50', '304b5b1', '45012'];
  const game = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 1, layout: fixed });
  const id = game.board.get({ row: 2, col: 2 })!.id;
  const { step } = firstStep(game, sw([3, 3], [3, 2]));
  assert.equal(step.combo, 'megaBomb');
  assert.ok(!step.cleared.some((p) => p.row === 2 && p.col === 2));
  assert.ok(game.board.grid.flat().some((p) => p?.id === id) || step.lanternsCollected.some((l) => l.id === id));
});

test('lantern spawning respects total and maxOnBoard, replay stays exact', () => {
  let collected = 0;
  for (let seed = 0; seed < 30; seed++) {
    const opts: GameOptions = {
      width: 6, height: 6, colors: 4, moves: 40, seed,
      lanterns: { total: 4, maxOnBoard: 2, spawnChance: 0.5 }, goals: [{ type: 'lanterns', count: 4 }],
    };
    const game = new Match3Game(opts);
    const rng = new Rng(seed);
    const seen = new Set<number>();
    while (game.status === 'playing') {
      const s = game.validSwaps();
      for (const e of game.swap(s[rng.int(s.length)]!).events) {
        if (e.type === 'cascade') collected += e.step.lanternsCollected.length;
      }
      const onBoard = game.board.grid.flat().filter((p) => p?.special === 'lantern');
      assert.ok(onBoard.length <= 2);
      onBoard.forEach((p) => seen.add(p!.id));
    }
    assert.ok(seen.size <= 4);
    const copy = Match3Game.replay(opts, game.history);
    assert.equal(copy.score, game.score);
    assert.equal(copy.status, game.status);
  }
  assert.ok(collected > 0, 'lanterns do get collected in random play');
});

test('timed level: timeUp loses, win gives no move bonus, timeUp needs timeLimit', () => {
  const timed = new Match3Game({ ...base, moves: 300, timeLimit: 60, goals: [{ type: 'collect', color: 0, count: 500 }] });
  timed.swap(sw([3, 2], [4, 2]));
  assert.equal(timed.status, 'playing');
  timed.timeUp();
  assert.equal(timed.status, 'lost');
  assert.deepEqual(timed.swap(timed.validSwaps()[0]!), { valid: false, events: [] });

  const won = new Match3Game({ ...base, moves: 300, timeLimit: 60, goals: [{ type: 'collect', color: 0, count: 3 }] });
  const res = won.swap(sw([3, 2], [4, 2]));
  assert.deepEqual(res.events.at(-1), { type: 'finale', movesLeft: 299, bonus: 0 });
  won.timeUp();
  assert.equal(won.status, 'won', 'time running out after a win changes nothing');

  assert.throws(() => new Match3Game(base).timeUp(), /timeLimit/);
});
