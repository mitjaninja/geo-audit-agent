import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidSwap, Match3Game } from '@sakura/core';
import { pickHint, sameSwap, seenIntros } from '../src/tutorial.ts';

test('hint is a valid move and prefers bigger matches', () => {
  // свап (0,2)↔(1,2) собирает пять нулей в ряд — это лучше любой тройки
  const layout = ['00100', '12034', '23412', '34123', '41234'];
  const game = new Match3Game({ width: 5, height: 5, colors: 5, moves: 5, seed: 1, layout });
  const hint = pickHint(game)!;
  assert.ok(isValidSwap(game.board, hint));
  assert.ok(sameSwap(hint, { a: { row: 0, col: 2 }, b: { row: 1, col: 2 } }), JSON.stringify(hint));
  assert.equal(game.history.length, 0, 'the real game is untouched');
});

test('sameSwap ignores direction', () => {
  const a = { row: 1, col: 1 };
  const b = { row: 1, col: 2 };
  assert.ok(sameSwap({ a, b }, { a: b, b: a }));
  assert.ok(!sameSwap({ a, b }, { a, b: { row: 2, col: 1 } }));
});

test('seen intros survive reloads and tolerate broken or missing storage', () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const s1 = seenIntros(storage);
  assert.equal(s1.has(3), false);
  s1.add(3);
  assert.equal(seenIntros(storage).has(3), true);
  mem.set('sakura.intros', '{broken');
  assert.equal(seenIntros(storage).has(3), false);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const s2 = seenIntros(throwing);
  s2.add(1);
  assert.equal(s2.has(1), true);
  assert.equal(seenIntros(null).has(1), false);
});
