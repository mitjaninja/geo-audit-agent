import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Rng } from '../src/index.ts';

test('same seed gives same sequence', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds diverge', () => {
  const a = new Rng(1);
  const b = new Rng(2);
  assert.notEqual(a.next(), b.next());
});

test('state can be restored', () => {
  const a = new Rng(7);
  a.next();
  const b = new Rng(a.state);
  assert.equal(a.next(), b.next());
});

test('int stays in range and covers all values', () => {
  const rng = new Rng(123);
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const v = rng.int(6);
    assert.ok(v >= 0 && v < 6 && Number.isInteger(v));
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});
