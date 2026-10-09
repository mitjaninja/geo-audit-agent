import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gameOptionsFromLevel, Match3Game, parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { autotestLevel, evaluate, formatReports, greedyBot, randomBot, targetBand, wilson } from '../src/index.ts';

const LEVELS = new URL('../../../levels/', import.meta.url);
const loadLevel = (id: number): LevelDef =>
  parseLevel(JSON.parse(readFileSync(new URL(`${String(id).padStart(4, '0')}.json`, LEVELS), 'utf8')));

const level = (over: Record<string, unknown>): LevelDef => parseLevel({
  id: 30, width: 7, height: 7, colors: 5, moves: 15, difficulty: 'normal',
  goals: [{ type: 'score', target: 1 }], stars: [1, 2, 3], ...over,
});

test('wilson interval', () => {
  const [lo, hi] = wilson(50, 100);
  assert.ok(Math.abs(lo - 0.404) < 0.002 && Math.abs(hi - 0.596) < 0.002);
  assert.deepEqual(wilson(0, 0), [0, 1]);
  assert.equal(wilson(10, 10)[1], 1);
});

test('target bands follow the PRD curve', () => {
  assert.deepEqual(targetBand({ id: 5, difficulty: 'normal' }), { min: 0.9, max: 1 });
  assert.deepEqual(targetBand({ id: 40, difficulty: 'normal' }), { min: 0.6, max: 0.7 });
  assert.deepEqual(targetBand({ id: 100, difficulty: 'normal' }), { min: 0.4, max: 0.55 });
  assert.deepEqual(targetBand({ id: 5, difficulty: 'hard' }), { min: 0.25, max: 0.35 });
  assert.deepEqual(targetBand({ id: 100, difficulty: 'superHard' }), { min: 0.15, max: 0.2 });
});

test('bots only pick valid swaps and do not touch the game', () => {
  const game = new Match3Game(gameOptionsFromLevel(loadLevel(5), 1));
  for (const bot of [randomBot(1), greedyBot(1)]) {
    const before = game.board.toStrings();
    const [moves, score] = [game.movesLeft, game.score];
    const swap = bot(game);
    assert.deepEqual(game.board.toStrings(), before);
    assert.deepEqual([game.movesLeft, game.score], [moves, score]);
    assert.equal(game.swap(swap).valid, true);
  }
});

test('evaluate prefers a win', () => {
  const lvl = level({});
  const game = new Match3Game(gameOptionsFromLevel(lvl, 1));
  const fresh = evaluate(game);
  game.swap(game.validSwaps()[0]!);
  assert.equal(game.status, 'won');
  assert.ok(evaluate(game) > fresh + 100);
});

test('greedy bot beats random on a goal level', () => {
  // фикстура, а не файл из levels/: контент уровней меняется при настройке
  const lvl = level({ id: 3, moves: 14, goals: [{ type: 'collect', color: 1, count: 28 }] });
  const greedy = autotestLevel(lvl, { runs: 15, bot: 'greedy' });
  const random = autotestLevel(lvl, { runs: 15, bot: 'random' });
  assert.ok(greedy.winRate > random.winRate, `greedy ${greedy.winRate} vs random ${random.winRate}`);
});

test('autotest is reproducible for the same seeds', () => {
  const lvl = loadLevel(2);
  const a = autotestLevel(lvl, { runs: 10, bot: 'random', seedBase: 7 });
  const b = autotestLevel(lvl, { runs: 10, bot: 'random', seedBase: 7 });
  assert.deepEqual([a.wins, a.stars, a.nearMissRate], [b.wins, b.stars, b.nearMissRate]);
});

test('verdicts: too hard, too easy, ok', () => {
  const impossible = autotestLevel(level({ id: 5, goals: [{ type: 'collect', color: 0, count: 500 }] }), { runs: 3, bot: 'random' });
  assert.equal(impossible.verdict, 'too_hard');
  assert.equal(impossible.wins, 0);
  const trivial = autotestLevel(level({ id: 30 }), { runs: 3, bot: 'random' });
  assert.equal(trivial.verdict, 'too_easy');
  const early = autotestLevel(level({ id: 3 }), { runs: 3, bot: 'random' });
  assert.equal(early.verdict, 'ok');
  assert.match(formatReports([impossible, trivial]), /TOO HARD[\s\S]*TOO EASY/);
});

test('near miss counts losses with goals at 80%+', () => {
  // 13 фишек цвета 0 за 3 хода почти никогда не набрать, 80% от 13 — 11: близкие проигрыши редки, но есть
  const hard = autotestLevel(level({ id: 5, moves: 3, goals: [{ type: 'collect', color: 0, count: 13 }] }), { runs: 60, bot: 'greedy' });
  assert.ok(hard.nearMissRate > 0 && hard.nearMissRate + hard.winRate <= 1);
});

test('hidden assist makes a hard level easier for the same seeds', () => {
  const lvl = loadLevel(3);
  const plain = autotestLevel(lvl, { runs: 60, bot: 'random' });
  const helped = autotestLevel(lvl, { runs: 60, bot: 'random', assist: 0.06 });
  assert.ok(helped.winRate > plain.winRate, `${helped.winRate} vs ${plain.winRate}`);
});

test('cli writes a json report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sakura-sim-'));
  const out = join(dir, 'report.json');
  const stdout = execFileSync(process.execPath, [
    '--import', 'tsx', new URL('../src/cli.ts', import.meta.url).pathname,
    new URL('0001.json', LEVELS).pathname, '--runs', '3', '--bot', 'random', '--json', out,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(stdout, /level\s+diff\s+bot/);
  const [report] = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.levelId, 1);
  assert.equal(report.runs, 3);
});

test('timed levels are played for timeLimit / SECONDS_PER_MOVE moves, then the timer ends', async () => {
  const { playOnce, SECONDS_PER_MOVE } = await import('../src/index.ts');
  const lvl = level({ id: 3, moves: 300, timeLimit: 36, goals: [{ type: 'score', target: 1 }] });
  const game = playOnce(lvl, 1, 'random');
  assert.equal(game.history.length, Math.round(36 / SECONDS_PER_MOVE));
  assert.equal(game.status, 'won');
  const hard = playOnce(level({ id: 3, moves: 300, timeLimit: 36, goals: [{ type: 'score', target: 10_000_000 }] }), 1, 'random');
  assert.equal(hard.status, 'lost');
});
