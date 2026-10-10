import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { autotestLevel, calibrate } from '../src/index.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const LEVELS = new Map<number, LevelDef>([
  [1, parseLevel({ ...base, id: 1, moves: 8, goals: [{ type: 'collect', color: 0, count: 11 }] })],
  [2, parseLevel({ ...base, id: 2, moves: 7, goals: [{ type: 'collect', color: 1, count: 11 }] })],
  [3, parseLevel({ ...base, id: 3, moves: 99, timeLimit: 24, goals: [{ type: 'collect', color: 2, count: 11 }] })],
]);

test('calibration recovers the skill and pace that produced the data', () => {
  // «живые» данные — от бота с skill 0.3 и 3 с на ход, на других сидах
  const truth = { skill: 0.3, secondsPerMove: 3 };
  const real = [...LEVELS.values()].map((level) => ({
    levelId: level.id, games: 300, winRate: autotestLevel(level, { runs: 300, bot: 'casual', seedBase: 10_000, model: truth }).winRate,
  }));
  assert.ok(real.some((r) => r.winRate > 0.15 && r.winRate < 0.85), `informative levels: ${JSON.stringify(real)}`);
  const c = calibrate(LEVELS, [...real, { levelId: 9, games: 5, winRate: 1 }], {
    runs: 150, skills: [0.1, 0.3, 0.6, 0.9], secondsPerMove: [2, 3, 5],
  });
  assert.equal(c.skill, 0.3);
  assert.equal(c.secondsPerMove, 3);
  assert.deepEqual(c.skipped, [9]);
  assert.equal(c.rows.length, 3);
});

test('calibration needs enough games on untimed levels', () => {
  assert.throws(() => calibrate(LEVELS, [{ levelId: 1, games: 3, winRate: 0.5 }], { runs: 10 }), /нет уровней/);
});
