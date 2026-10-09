import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Board, comboKind, findMatches, Match3Game, specialForGroup } from '../src/index.ts';
import type { CascadeStep, Pos, Swap } from '../src/index.ts';

/** Поле 5×5 без матчей: цвета идут диагоналями. */
const BASE = ['01234', '12345', '23450', '34501', '45012'];

function layout(rows: string[], overrides: Record<string, string> = {}): string[] {
  const cells = rows.map((r) => r.match(/\d[hvb]?|\*/g)!);
  for (const [k, tok] of Object.entries(overrides)) {
    const [row, col] = k.split(',').map(Number) as [number, number];
    cells[row]![col] = tok;
  }
  return cells.map((r) => r.join(''));
}

function play(rows: string[], swap: Swap): { game: Match3Game; first: CascadeStep } {
  const game = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 1, layout: rows });
  const res = game.swap(swap);
  assert.equal(res.valid, true, 'swap is valid');
  const first = res.events.find((e) => e.type === 'cascade');
  assert.ok(first?.type === 'cascade');
  return { game, first: first.step };
}

const sw = (a: [number, number], b: [number, number]): Swap => ({ a: { row: a[0], col: a[1] }, b: { row: b[0], col: b[1] } });
const has = (cells: Pos[], row: number, col: number) => cells.some((p) => p.row === row && p.col === col);

test('fromStrings parses special tokens', () => {
  const b = Board.fromStrings(['0h1v2b', '*12', '012']);
  assert.equal(b.get({ row: 0, col: 0 })?.special, 'lineH');
  assert.equal(b.get({ row: 0, col: 1 })?.special, 'lineV');
  assert.equal(b.get({ row: 0, col: 2 })?.special, 'bomb');
  assert.equal(b.get({ row: 1, col: 0 })?.special, 'rainbow');
  assert.equal(b.get({ row: 1, col: 0 })?.color, null);
  assert.throws(() => Board.fromStrings(['0x1', '012', '120']));
});

test('rainbows never form matches by themselves', () => {
  assert.deepEqual(findMatches(Board.fromStrings(['***', '012', '120'])), []);
});

test('specialForGroup priority', () => {
  const line = (n: number, horizontal: boolean) => ({
    color: 0 as const, longestLine: n, isCross: false,
    cells: Array.from({ length: n }, (_, i) => (horizontal ? { row: 0, col: i } : { row: i, col: 0 })),
  });
  assert.equal(specialForGroup(line(3, true)), null);
  assert.equal(specialForGroup(line(4, true)), 'lineV');
  assert.equal(specialForGroup(line(4, false)), 'lineH');
  assert.equal(specialForGroup(line(5, true)), 'rainbow');
  assert.equal(specialForGroup({ ...line(3, true), isCross: true }), 'bomb');
  assert.equal(specialForGroup({ ...line(5, true), isCross: true }), 'rainbow');
});

test('4 in a row creates a beam at the swapped cell', () => {
  const rows = ['00102', '12034', '34245', '45313', '23451'];
  const { first } = play(rows, sw([1, 2], [0, 2]));
  assert.equal(first.created.length, 1);
  assert.deepEqual(first.created[0]?.at, { row: 0, col: 2 });
  assert.equal(first.created[0]?.piece.special, 'lineV');
  assert.equal(first.created[0]?.piece.color, 0);
  assert.equal(first.cleared.length, 4);
  assert.equal(first.spawns.length, 3);
});

test('5 in a row creates a rainbow', () => {
  const rows = ['00100', '12034', '34245', '45313', '23451'];
  const { first } = play(rows, sw([1, 2], [0, 2]));
  assert.equal(first.created.length, 1);
  assert.deepEqual(first.created[0]?.at, { row: 0, col: 2 });
  assert.equal(first.created[0]?.piece.special, 'rainbow');
  assert.equal(first.created[0]?.piece.color, null);
});

const L_ROWS = ['12345', '23451', '00102', '34013', '45024'];

test('L shape creates a bomb at the corner', () => {
  const { first } = play(L_ROWS, sw([2, 3], [2, 2]));
  assert.equal(first.groups.length, 1);
  assert.equal(first.created[0]?.piece.special, 'bomb');
  assert.deepEqual(first.created[0]?.at, { row: 2, col: 2 });
});

test('beam inside a match fires and clears its column', () => {
  const rows = layout(L_ROWS, { '2,0': '0v' });
  const { first } = play(rows, sw([2, 3], [2, 2]));
  assert.deepEqual(first.activations, [{ at: { row: 2, col: 0 }, special: 'lineV' }]);
  for (let row = 0; row < 5; row++) assert.ok(has(first.cleared, row, 0), `row ${row} of column 0 cleared`);
  assert.equal(first.cleared.length, 9);
});

test('chain: beam hits a bomb, bomb explodes 3x3', () => {
  const rows = layout(L_ROWS, { '2,0': '0v', '4,0': '4b' });
  const { first } = play(rows, sw([2, 3], [2, 2]));
  assert.deepEqual(first.activations.map((a) => a.special), ['lineV', 'bomb']);
  assert.ok(has(first.cleared, 3, 1) && has(first.cleared, 4, 1), 'bomb reached next column');
});

test('special + normal without a match is not a valid move', () => {
  const rows = layout(BASE, { '0,0': '0h' });
  const game = new Match3Game({ width: 5, height: 5, colors: 6, moves: 10, seed: 1, layout: rows });
  const res = game.swap(sw([0, 0], [1, 0]));
  assert.equal(res.valid, false);
  assert.equal(game.movesLeft, 10);
});

test('comboKind table', () => {
  const p = (special: string) => ({ id: 0, color: special === 'rainbow' ? null : 0, special }) as never;
  assert.equal(comboKind(p('rainbow'), p('rainbow')), 'sakuraStorm');
  assert.equal(comboKind(p('rainbow'), p('none')), 'colorBlast');
  assert.equal(comboKind(p('lineH'), p('rainbow')), 'rainbowLine');
  assert.equal(comboKind(p('rainbow'), p('bomb')), 'rainbowBomb');
  assert.equal(comboKind(p('lineH'), p('lineV')), 'doubleLine');
  assert.equal(comboKind(p('bomb'), p('lineV')), 'crossFlash');
  assert.equal(comboKind(p('bomb'), p('bomb')), 'megaBomb');
  assert.equal(comboKind(p('bomb'), p('none')), null);
  assert.equal(comboKind(p('none'), p('none')), null);
});

test('rainbow + normal clears all pieces of that color', () => {
  const rows = layout(BASE, { '0,0': '*' });
  const { first } = play(rows, sw([0, 0], [0, 1]));
  assert.equal(first.combo, 'colorBlast');
  // (0,1) цвета 1 — значит уходят все единицы и сама радуга
  const color1 = BASE.join('').split('').filter((c) => c === '1').length;
  assert.equal(first.cleared.length, color1 + 1);
  assert.deepEqual(first.activations, []);
});

test('rainbow + rainbow (Sakura storm) clears the whole board', () => {
  const rows = layout(BASE, { '2,2': '*', '2,3': '*' });
  const { first } = play(rows, sw([2, 2], [2, 3]));
  assert.equal(first.combo, 'sakuraStorm');
  assert.equal(first.cleared.length, 25);
});

test('beam + beam clears row and column', () => {
  const rows = layout(BASE, { '2,2': '4h', '2,3': '5v' });
  const { first } = play(rows, sw([2, 3], [2, 2]));
  assert.equal(first.combo, 'doubleLine');
  assert.equal(first.cleared.length, 9);
  for (let i = 0; i < 5; i++) assert.ok(has(first.cleared, 2, i) && has(first.cleared, i, 2));
});

test('beam + bomb (Cross flash) clears three rows and three columns', () => {
  const rows = layout(BASE, { '2,2': '4h', '2,3': '5b' });
  const { first } = play(rows, sw([2, 3], [2, 2]));
  assert.equal(first.combo, 'crossFlash');
  assert.equal(first.cleared.length, 21, '5x5 minus four corner cells');
  assert.ok(!has(first.cleared, 0, 0) && !has(first.cleared, 4, 4));
});

test('bomb + bomb clears 5x5', () => {
  const rows = layout(BASE, { '2,2': '4b', '2,3': '5b' });
  const { first } = play(rows, sw([2, 3], [2, 2]));
  assert.equal(first.combo, 'megaBomb');
  assert.equal(first.cleared.length, 25);
});

test('rainbow + bomb turns that color into bombs that all explode', () => {
  const rows = layout(BASE, { '0,0': '*', '0,1': '1b' });
  const { first } = play(rows, sw([0, 0], [0, 1]));
  assert.equal(first.combo, 'rainbowBomb');
  const color1 = BASE.join('').split('').filter((c) => c === '1').length;
  assert.ok(first.activations.filter((a) => a.special === 'bomb').length >= color1);
  assert.ok(first.cleared.length > color1 + 1);
});

test('rainbow + beam turns that color into beams that all fire', () => {
  const rows = layout(BASE, { '0,0': '*', '0,1': '1h' });
  const { first } = play(rows, sw([0, 0], [0, 1]));
  assert.equal(first.combo, 'rainbowLine');
  const color1 = BASE.join('').split('').filter((c) => c === '1').length;
  const beams = first.activations.filter((a) => a.special === 'lineH' || a.special === 'lineV');
  assert.ok(beams.length >= color1);
});

test('random play creates specials and combos and stays replayable', () => {
  const made = new Set<string>();
  const combos = new Set<string>();
  for (let seed = 0; seed < 40; seed++) {
    const opts = { width: 7, height: 7, colors: 4, moves: 40, seed };
    const game = new Match3Game(opts);
    let i = seed;
    while (game.status === 'playing') {
      const swaps = game.validSwaps();
      // предпочитаем комбо, чтобы прогнать все ветки
      const combo = swaps.find((s) => game.board.get(s.a)!.special !== 'none' || game.board.get(s.b)!.special !== 'none');
      const res = game.swap(combo ?? swaps[i++ % swaps.length]!);
      for (const e of res.events) {
        if (e.type !== 'cascade') continue;
        e.step.created.forEach((c) => made.add(c.piece.special));
        if (e.step.combo) combos.add(e.step.combo);
      }
    }
    assert.deepEqual(findMatches(game.board), []);
    const copy = Match3Game.replay(opts, game.history);
    assert.equal(copy.score, game.score);
    assert.deepEqual(copy.board.toStrings(), game.board.toStrings());
  }
  assert.deepEqual([...made].sort(), ['bomb', 'lineH', 'lineV', 'rainbow']);
  assert.ok(combos.size >= 4, `combos seen: ${[...combos]}`);
});
