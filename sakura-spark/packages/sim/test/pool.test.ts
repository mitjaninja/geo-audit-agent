import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLevel } from '@sakura/core';
import { autotestLevel, runJobs } from '../src/index.ts';

const base = { width: 6, height: 6, colors: 5, difficulty: 'normal', stars: [1, 2, 3] };
const levels = [1, 2, 3].map((id) => parseLevel({ ...base, id, moves: 6 + id, goals: [{ type: 'collect', color: 0, count: 10 }] }));

test('worker pool gives the same reports as a single thread, in order', async () => {
  const jobs = levels.map((level) => ({ kind: 'autotest' as const, level, options: { runs: 30, bot: 'greedy' as const } }));
  const done: number[] = [];
  const par = await runJobs(jobs, 2, (i) => done.push(i));
  const seq = levels.map((l) => autotestLevel(l, { runs: 30, bot: 'greedy' }));
  assert.deepEqual(par.map((r) => [r.levelId, r.wins, r.stars]), seq.map((r) => [r.levelId, r.wins, r.stars]));
  assert.deepEqual([...done].sort(), [0, 1, 2]);
});
