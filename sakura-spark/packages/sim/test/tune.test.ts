import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLevel } from '@sakura/core';
import { autotestLevel, formatLevel, searchMoves, starThresholds } from '../src/index.ts';

test('searchMoves finds the moves closest to the band centre', () => {
  // win rate = moves / 40: центр коридора 0.65 → 26 ходов
  const calls: number[] = [];
  const r = searchMoves((m) => { calls.push(m); return Math.min(1, m / 40); }, { min: 0.6, max: 0.7 }, 8, 50);
  assert.equal(r.moves, 26);
  assert.ok(Math.abs(r.winRate - 0.65) < 0.02);
  assert.ok(calls.length <= 8, 'binary search, not a full scan');
  // уровень, который даже на максимуме ходов слишком сложен, получает максимум
  assert.equal(searchMoves(() => 0.1, { min: 0.9, max: 1 }, 8, 50).moves, 50);
  // ранние уровни (коридор до 100%) целятся в 97%, а не в центр 95%
  assert.equal(searchMoves((m) => Math.min(1, m / 40), { min: 0.9, max: 1 }, 8, 50).moves, 39);
});

test('star thresholds are increasing and respect the score goal', () => {
  const scores = Array.from({ length: 100 }, (_, i) => 2000 + i * 30);
  const [s1, s2, s3] = starThresholds(scores);
  assert.ok(s1 < s2 && s2 < s3);
  assert.ok(s2 >= 3400 && s2 <= 3600, `median ≈ 3500, got ${s2}`);
  assert.ok(s3 >= 4500);
  const withGoal = starThresholds(scores, 1500);
  assert.equal(withGoal[0], 1500);
  assert.ok(withGoal[1] >= 1950);
  const none = starThresholds([]);
  assert.ok(none[0] < none[1] && none[1] < none[2]);
});

test('formatLevel round-trips through the validator', () => {
  const raw = {
    id: 9, width: 6, height: 6, colors: 5, moves: 20, difficulty: 'normal',
    shape: ['_####_', '######', '######', '######', '######', '_####_'],
    jelly: ['_0000_', '011110', '011110', '011110', '011110', '_0000_'],
    portals: [{ from: [0, 1], to: [3, 4] }],
    goals: [{ type: 'jelly' }], stars: [100, 200, 300],
    intro: [{ speaker: 'mika', text: 'Привет' }],
  };
  const text = formatLevel(raw);
  assert.deepEqual(parseLevel(JSON.parse(text)), parseLevel(raw));
  assert.match(text, /\n {4}"/, 'grids one row per line');
});

test('casual bot sits between random and greedy', () => {
  const lvl = parseLevel({
    id: 3, width: 7, height: 7, colors: 5, moves: 18, difficulty: 'normal',
    goals: [{ type: 'collect', color: 0, count: 30 }], stars: [100, 200, 300],
  });
  const runs = 30;
  const [random, casual, greedy] = (['random', 'casual', 'greedy'] as const).map((bot) => autotestLevel({ ...lvl, moves: 18 }, { runs, bot }).winRate);
  assert.ok(random! <= casual! && casual! <= greedy!, `${random} ≤ ${casual} ≤ ${greedy}`);
  assert.ok(random! < greedy!);
});
