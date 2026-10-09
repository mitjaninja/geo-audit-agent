import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Match3Game, parseLevel, LevelError, Rng } from '../src/index.ts';
import type { CascadeStep, GameEvent, GameOptions, Swap } from '../src/index.ts';

const sw = (a: [number, number], b: [number, number]): Swap => ({ a: { row: a[0], col: a[1] }, b: { row: b[0], col: b[1] } });
const at = (row: number, col: number) => ({ row, col });

/** Свап (3,2)↔(4,2) собирает 000 в (3,0)(3,1)(3,2). Соседи матча: (2,0..2), (4,0..1), (3,3). */
const ROWS = ['12345', '23451', '34512', '00234', '34051'];
const NONE = ['.....', '.....', '.....', '.....', '.....'];

function withBlockers(changes: Record<string, string>, layoutChanges: Record<string, string> = {}): Pick<GameOptions, 'layout' | 'blockers'> {
  const grid = NONE.map((r) => [...r]);
  const layout = ROWS.map((r) => [...r]);
  for (const [k, ch] of Object.entries(changes)) {
    const [r, c] = k.split(',').map(Number) as [number, number];
    grid[r]![c] = ch;
    if (ch !== 'v') layout[r]![c] = '.';
  }
  for (const [k, ch] of Object.entries(layoutChanges)) {
    const [r, c] = k.split(',').map(Number) as [number, number];
    layout[r]![c] = ch;
  }
  return { layout: layout.map((r) => r.join('')), blockers: grid.map((r) => r.join('')) };
}

function play(opts: Partial<GameOptions>, swap: Swap) {
  const game = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 5, ...opts });
  const res = game.swap(swap);
  assert.equal(res.valid, true, 'swap is valid');
  const first = res.events.find((e) => e.type === 'cascade');
  assert.ok(first?.type === 'cascade');
  return { game, first: first.step as CascadeStep, events: res.events as GameEvent[] };
}

test('ice loses a layer from an adjacent match', () => {
  const { game, first } = play(withBlockers({ '2,1': 'I', '2,4': 'i' }), sw([3, 2], [4, 2]));
  assert.deepEqual(first.blockersHit, [{ at: at(2, 1), kind: 'ice', layersLeft: 1 }]);
  assert.deepEqual(game.board.blockerAt(at(2, 1)), { kind: 'ice', layers: 1 });
  assert.deepEqual(game.board.blockerAt(at(2, 4)), { kind: 'ice', layers: 1 }, 'far ice untouched');
});

test('pieces fall through an ice cell', () => {
  const { first } = play(withBlockers({ '2,1': 'I' }), sw([3, 2], [4, 2]));
  assert.ok(first.falls.some((f) => f.from.row === 1 && f.from.col === 1 && f.to.row === 3 && f.to.col === 1),
    'piece from row 1 skipped the ice in row 2');
  assert.ok(!first.spawns.some((s) => s.at.row === 2 && s.at.col === 1), 'nothing spawns inside ice');
});

test('daifuku ignores adjacent matches', () => {
  const { game, first } = play(withBlockers({ '2,1': 'm' }), sw([3, 2], [4, 2]));
  assert.deepEqual(first.blockersHit, []);
  assert.equal(game.board.blockerAt(at(2, 1))?.kind, 'daifuku');
});

test('daifuku breaks from a blast', () => {
  // луч в (3,0): горизонтальный — бьёт ряд 3; дайфуку в (3,4)
  const opts = withBlockers({ '3,4': 'm' }, { '3,0': '0h' });
  const { first } = play(opts, sw([3, 2], [4, 2]));
  assert.deepEqual(first.activations.map((a) => a.special), ['lineH']);
  assert.ok(first.blockersHit.some((b) => b.kind === 'daifuku' && b.layersLeft === 0));
});

test('vines: locked piece cannot be swapped', () => {
  const game = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 5, ...withBlockers({ '4,2': 'v' }) });
  const res = game.swap(sw([3, 2], [4, 2]));
  assert.deepEqual(res, { valid: false, events: [] });
  assert.equal(game.movesLeft, 10);
});

test('vines: locked piece still matches; the hit removes vines and keeps the piece', () => {
  const opts = withBlockers({ '3,0': 'v' });
  const game0 = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 5, ...opts });
  const lockedId = game0.board.get(at(3, 0))!.id;
  const { game, first } = play(opts, sw([3, 2], [4, 2]));
  assert.deepEqual(first.blockersHit, [{ at: at(3, 0), kind: 'vines', layersLeft: 0 }]);
  assert.ok(!first.cleared.some((p) => p.row === 3 && p.col === 0));
  assert.equal(game.board.get(at(3, 0))?.id, lockedId, 'piece stays in place');
  assert.equal(game.board.blockerAt(at(3, 0)), null);
});

test('vines: locked piece does not fall', () => {
  // фишка под лианами в (2,2) прямо над снятой клеткой (3,2)
  const opts = withBlockers({ '2,2': 'v' });
  const game0 = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 5, ...opts });
  const lockedId = game0.board.get(at(2, 2))!.id;
  const { game, first } = play(opts, sw([3, 2], [4, 2]));
  assert.ok(!first.falls.some((f) => f.id === lockedId));
  assert.equal(game.board.get(at(2, 2))?.id, lockedId);
  assert.ok(first.falls.some((f) => f.from.row === 1 && f.from.col === 2 && f.to.row === 3 && f.to.col === 2),
    'piece above the vines falls past it');
});

test('opened chest leaves a beam or a bomb', () => {
  const { first } = play(withBlockers({ '2,0': 'k' }), sw([3, 2], [4, 2]));
  assert.deepEqual(first.blockersHit, [{ at: at(2, 0), kind: 'chest', layersLeft: 0 }]);
  const reward = first.created.find((c) => c.at.row === 2 && c.at.col === 0);
  assert.ok(reward && ['lineH', 'lineV', 'bomb'].includes(reward.piece.special));
});

test('fog cleared by a match counts for the goal; clearing all fog wins', () => {
  const { game, first } = play({ ...withBlockers({ '2,0': 'f' }), goals: [{ type: 'fog' }] }, sw([3, 2], [4, 2]));
  assert.deepEqual(first.blockersHit, [{ at: at(2, 0), kind: 'fog', layersLeft: 0 }]);
  assert.equal(game.status, 'won');
  assert.deepEqual(game.goalProgress().map((g) => [g.current, g.target]), [[1, 1]]);
});

test('untouched fog spreads onto a neighbouring piece', () => {
  const opts = { ...withBlockers({ '0,4': 'f' }), goals: [{ type: 'fog' as const }] };
  const { game, events } = play(opts, sw([3, 2], [4, 2]));
  const spread = events.find((e) => e.type === 'fogSpread');
  assert.ok(spread?.type === 'fogSpread');
  assert.deepEqual(spread.from, at(0, 4));
  assert.ok([[0, 3], [1, 4]].some(([r, c]) => spread.to.row === r && spread.to.col === c));
  assert.equal(game.board.blockerAt(spread.to)?.kind, 'fog');
  assert.equal(game.board.get(spread.to), null);
  assert.equal(game.fogOnBoard, 2);
  assert.deepEqual(game.goalProgress().map((g) => [g.current, g.target]), [[0, 2]]);
});

test('fog does not spread on a move that cleared fog', () => {
  const { events } = play(withBlockers({ '2,0': 'f', '0,4': 'f' }), sw([3, 2], [4, 2]));
  assert.ok(!events.some((e) => e.type === 'fogSpread'));
});

test('portal carries pieces into another column', () => {
  // вход в (1,4) над дырой (2,4), выход в (3,0) под дырой (2,0)
  const layout = ['12345', '23451', '_451_', '00234', '34051'];
  const game = new Match3Game({
    width: 5, height: 5, colors: 6, moves: 10, seed: 5, layout, portals: [{ from: at(1, 4), to: at(3, 0) }],
  });
  const fromPortal = game.board.get(at(1, 4))!.id;
  const res = game.swap(sw([3, 2], [4, 2]));
  const step = res.events.find((e) => e.type === 'cascade');
  assert.ok(step?.type === 'cascade');
  assert.ok(step.step.falls.some((f) => f.id === fromPortal && f.to.row === 3 && f.to.col === 0),
    'piece from (1,4) went through the portal into (3,0)');
});

test('portal loop is rejected', () => {
  const layout = ['12345', '23451', '34512', '45123', '51234'];
  assert.throws(() => new Match3Game({
    width: 5, height: 5, colors: 6, moves: 10, seed: 1, layout,
    portals: [{ from: at(4, 0), to: at(0, 1) }, { from: at(4, 1), to: at(0, 0) }],
  }), /loop/);
});

test('layout must leave cells under blockers empty', () => {
  assert.throws(() => new Match3Game({
    width: 5, height: 5, colors: 6, moves: 10, seed: 1, layout: ROWS, blockers: ['i....', ...NONE.slice(1)],
  }), /must be '\.'/);
});

test('level validator: blockers and portals', () => {
  const base = {
    id: 9, width: 6, height: 6, colors: 5, moves: 25, difficulty: 'hard', stars: [1000, 2000, 3000],
  };
  const blockers = ['......', '.iI...', '..ff..', '..kK..', '.mMv..', '......'];
  const level = parseLevel({ ...base, blockers, goals: [{ type: 'fog' }] });
  assert.deepEqual(level.blockers, blockers);
  const errs = (input: unknown) => {
    try { parseLevel(input); } catch (e) { assert.ok(e instanceof LevelError); return e.errors.join(); }
    return assert.fail('expected LevelError');
  };
  assert.match(errs({ ...base, goals: [{ type: 'fog' }] }), /fog goal needs fog/);
  assert.match(errs({ ...base, blockers: ['x.....', ...blockers.slice(1)], goals: [{ type: 'score', target: 1 }] }), /bad characters/);
  assert.match(errs({ ...base, goals: [{ type: 'score', target: 1 }], portals: [{ from: [0, 0], to: [5, 0] }] }), /different columns/);
  assert.match(errs({ ...base, goals: [{ type: 'score', target: 1 }], portals: [{ from: [0, 0], to: [9, 9] }] }), /on the board/);
  assert.match(errs({
    ...base, goals: [{ type: 'score', target: 1 }],
    portals: [{ from: [5, 0], to: [0, 1] }, { from: [5, 1], to: [0, 0] }],
  }), /board: .*loop/);
});

test('random play with every blocker stays consistent and replayable', () => {
  const opts: Omit<GameOptions, 'seed'> = {
    width: 7, height: 7, colors: 4, moves: 40,
    shape: ['###_###', '#######', '#######', '#######', '#######', '#######', '###_###'],
    blockers: ['.......', '.I...k.', '..f.f..', 'm.v.v.M', '..iii..', '.......', '.......'],
    // столбец 3 (над дырой в (6,3)) уходит через портал в столбец 6
    portals: [{ from: at(5, 3), to: at(1, 6) }],
    goals: [{ type: 'fog' }, { type: 'score', target: 999999 }],
  };
  let hits = 0;
  let portalFalls = 0;
  for (let seed = 0; seed < 25; seed++) {
    const game = new Match3Game({ ...opts, seed });
    const rng = new Rng(seed);
    while (game.status === 'playing') {
      const s = game.validSwaps();
      for (const e of game.swap(s[rng.int(s.length)]!).events) {
        if (e.type !== 'cascade') continue;
        hits += e.step.blockersHit.length;
        portalFalls += e.step.falls.filter((f) => f.from.col === 3 && f.to.col === 6).length;
      }
      for (const p of game.board.playableCells()) {
        const b = game.board.blockerAt(p);
        const piece = game.board.get(p);
        if (b && b.kind !== 'vines') assert.equal(piece, null, 'occupied cell has no piece');
        else assert.ok(piece, `cell ${p.row},${p.col} is filled`);
      }
    }
    const copy = Match3Game.replay({ ...opts, seed }, game.history);
    assert.equal(copy.score, game.score);
    assert.deepEqual(copy.board.toStrings(), game.board.toStrings());
  }
  assert.ok(hits > 0);
  assert.ok(portalFalls > 0, 'pieces used the portal');
});
