import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Board, findValidSwaps, isAdjacent, swapMakesMatch } from '../src/index.ts';

test('isAdjacent', () => {
  assert.equal(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 1 }), true);
  assert.equal(isAdjacent({ row: 0, col: 0 }, { row: 1, col: 1 }), false);
  assert.equal(isAdjacent({ row: 0, col: 0 }, { row: 0, col: 0 }), false);
});

test('swapMakesMatch detects a move and leaves board untouched', () => {
  const b = Board.fromStrings([
    '0010',
    '1201',
    '2312',
  ]);
  const before = b.toStrings();
  assert.equal(swapMakesMatch(b, { a: { row: 0, col: 2 }, b: { row: 0, col: 3 } }), true);
  assert.equal(swapMakesMatch(b, { a: { row: 0, col: 0 }, b: { row: 1, col: 0 } }), false);
  assert.equal(swapMakesMatch(b, { a: { row: 0, col: 0 }, b: { row: 2, col: 0 } }), false, 'not adjacent');
  assert.equal(swapMakesMatch(b, { a: { row: 0, col: 3 }, b: { row: 0, col: 4 } }), false, 'out of bounds');
  assert.deepEqual(b.toStrings(), before);
});

test('findValidSwaps on a dead board is empty', () => {
  const b = Board.fromStrings(['0123', '2301', '0123', '2301'], 4);
  assert.deepEqual(findValidSwaps(b), []);
});

test('findValidSwaps lists each valid pair once', () => {
  const b = Board.fromStrings([
    '0010',
    '1201',
    '2312',
  ]);
  const swaps = findValidSwaps(b);
  assert.ok(swaps.length >= 1);
  for (const s of swaps) assert.ok(swapMakesMatch(b, s));
  const keys = swaps.map((s) => `${s.a.row},${s.a.col}-${s.b.row},${s.b.col}`);
  assert.equal(new Set(keys).size, keys.length);
});
