import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Board, findMatches, hasMatchAt } from '../src/index.ts';

test('no matches on a clean board', () => {
  const b = Board.fromStrings(['012', '120', '201']);
  assert.deepEqual(findMatches(b), []);
});

test('horizontal and vertical triples', () => {
  const b = Board.fromStrings([
    '0001',
    '1232',
    '1342',
    '1452',
  ]);
  const groups = findMatches(b);
  assert.equal(groups.length, 3);
  const sizes = groups.map((g) => g.cells.length).sort();
  assert.deepEqual(sizes, [3, 3, 3]);
  assert.ok(groups.every((g) => g.longestLine === 3 && !g.isCross));
});

test('line of 5 is reported with longestLine 5', () => {
  const b = Board.fromStrings(['22222', '01010', '10101']);
  const [g] = findMatches(b);
  assert.equal(g?.longestLine, 5);
  assert.equal(g?.cells.length, 5);
});

test('L shape merges into one cross group', () => {
  const b = Board.fromStrings([
    '3012',
    '3120',
    '3332',
  ]);
  const groups = findMatches(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.cells.length, 5);
  assert.equal(groups[0]?.isCross, true);
  assert.equal(groups[0]?.color, 3);
});

test('T shape merges into one cross group', () => {
  const b = Board.fromStrings([
    '444',
    '040',
    '141',
  ]);
  const groups = findMatches(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.cells.length, 5);
  assert.equal(groups[0]?.isCross, true);
});

test('empty cells break runs', () => {
  const b = Board.fromStrings(['00.0', '1212', '2121']);
  assert.deepEqual(findMatches(b), []);
});

test('hasMatchAt', () => {
  const b = Board.fromStrings(['001', '120', '201']);
  assert.equal(hasMatchAt(b, { row: 0, col: 0 }), false);
  b.set({ row: 0, col: 2 }, b.makePiece(0));
  assert.equal(hasMatchAt(b, { row: 0, col: 2 }), true);
});
