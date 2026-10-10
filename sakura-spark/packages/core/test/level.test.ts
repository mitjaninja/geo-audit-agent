import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gameOptionsFromLevel, LevelError, lintLevel, Match3Game, parseLevel, Rng } from '../src/index.ts';

const LEVELS_DIR = new URL('../../../levels/', import.meta.url);

const valid = {
  id: 7, width: 7, height: 7, colors: 5, moves: 20, difficulty: 'hard',
  goals: [{ type: 'score', target: 1000 }], stars: [1000, 2000, 3000],
};

function errorsOf(input: unknown): string[] {
  try {
    parseLevel(input);
  } catch (e) {
    assert.ok(e instanceof LevelError);
    return e.errors;
  }
  assert.fail('expected LevelError');
}

test('valid level parses and builds a game', () => {
  const level = parseLevel(valid);
  assert.equal(level.difficulty, 'hard');
  const game = new Match3Game(gameOptionsFromLevel(level, 1));
  assert.equal(game.movesLeft, 20);
  assert.equal(game.status, 'playing');
});

test('all errors are reported at once', () => {
  const errors = errorsOf({ ...valid, id: 0, moves: -1, difficulty: 'easy', stars: [3, 2, 1] });
  assert.equal(errors.length, 4, errors.join('; '));
});

test('goal consistency checks', () => {
  assert.match(errorsOf({ ...valid, goals: [{ type: 'jelly' }] }).join(), /jelly grid/);
  assert.match(errorsOf({ ...valid, goals: [{ type: 'lanterns', count: 2 }] }).join(), /lanterns rule/);
  assert.match(errorsOf({ ...valid, goals: [{ type: 'collect', color: 5, count: 10 }] }).join(), /color/);
  assert.match(errorsOf({ ...valid, goals: [] }).join(), /1\.\.3/);
  assert.match(errorsOf({ ...valid, goals: [{ type: 'timer' }] }).join(), /type/);
  assert.match(errorsOf({ ...valid, goals: [{ type: 'score', target: 1 }, { type: 'score', target: 2 }] }).join(), /duplicate/);
  assert.match(errorsOf({
    ...valid, lanterns: { total: 1, maxOnBoard: 1, spawnChance: 0.5 }, goals: [{ type: 'lanterns', count: 3 }],
  }).join(), /total/);
  assert.match(errorsOf({ ...valid, lanterns: { total: 1, maxOnBoard: 1, spawnChance: 0.5 } }).join(), /without a lanterns goal/);
});

test('grid checks', () => {
  const row = '#######';
  assert.match(errorsOf({ ...valid, shape: [row] }).join(), /shape/);
  assert.match(errorsOf({ ...valid, shape: Array(7).fill('###x###') }).join(), /bad characters/);
  const shape = ['_######', ...Array(6).fill(row)];
  const jelly = ['1000000', ...Array(6).fill('0000000')];
  assert.match(errorsOf({ ...valid, shape, jelly, goals: [{ type: 'jelly' }] }).join(), /hole/);
  assert.match(errorsOf({ ...valid, shape, layout: Array(7).fill('0123401') }).join(), /exclusive/);
});

test('non-object input', () => {
  assert.throws(() => parseLevel(null), LevelError);
  assert.throws(() => parseLevel([]), LevelError);
});

test('every level in levels/ is valid, named by id, and playable', () => {
  const files = readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 3);
  const ids = new Set<number>();
  for (const file of files) {
    const level = parseLevel(JSON.parse(readFileSync(new URL(file, LEVELS_DIR), 'utf8')));
    assert.equal(file, `${String(level.id).padStart(4, '0')}.json`);
    assert.ok(!ids.has(level.id));
    ids.add(level.id);
    assert.deepEqual(lintLevel(level), [], file);
    // проходимость: простой жадный выбор хода (сначала прогресс целей, потом снятые фишки) с двойным
    // запасом ходов иногда выигрывает. Это ловит сломанный уровень; точная сложность — дело автотеста
    let wins = 0;
    for (let seed = 0; seed < 12 && wins === 0; seed++) {
      const game = new Match3Game({ ...gameOptionsFromLevel(level, seed), moves: level.moves * 2 });
      const rng = new Rng(seed);
      while (game.status === 'playing') {
        let best = game.validSwaps()[0]!;
        let bestValue = -1;
        for (const s of game.validSwaps()) {
          const copy = game.clone(rng.int(1e9));
          const step = copy.swap(s).events.find((e) => e.type === 'cascade');
          const goals = copy.goalProgress().reduce((sum, g) => sum + (g.target > 0 ? Math.min(1, g.current / g.target) : 1), 0);
          const value = goals * 1000 + (step?.type === 'cascade' ? step.step.cleared.length + step.step.created.length * 3 : 0);
          if (value > bestValue) [best, bestValue] = [s, value];
        }
        game.swap(best);
      }
      if (game.status === 'won') wins++;
    }
    assert.ok(wins > 0, `${file}: a sensible player wins sometimes`);
  }
});

test('intro lines and tutorial swap', () => {
  // в (0,0)…(0,2) ставим 0,0,1 и 0 в (1,2): свап (0,2)↔(1,2) собирает три нуля
  const rows = ['00134', '12043', '23401', '34012', '40123'];
  const base = { ...valid, width: 5, height: 5, colors: 5, layout: rows };
  const lvl = parseLevel({
    ...base,
    intro: [{ speaker: 'mika', text: 'Привет!' }, { speaker: 'pon', text: 'Я подскажу.' }],
    tutorial: { swap: [[0, 2], [1, 2]], text: 'Поменяй фишки' },
  });
  assert.equal(lvl.intro?.length, 2);
  assert.deepEqual(lvl.tutorial?.swap, { a: { row: 0, col: 2 }, b: { row: 1, col: 2 } });
  assert.match(errorsOf({ ...base, intro: [{ speaker: 'kurogiri', text: 'ха' }] }).join(), /intro/);
  assert.match(errorsOf({ ...base, intro: [{ speaker: 'mika', text: 'x'.repeat(161) }] }).join(), /intro/);
  assert.match(errorsOf({ ...base, tutorial: { swap: [[0, 0], [4, 4]], text: 'нет' } }).join(), /not a valid move/);
  assert.match(errorsOf({ ...valid, tutorial: { swap: [[0, 0], [0, 1]], text: 'нет' } }).join(), /fixed layout/);
});

test('lint: a cell under a portal entry that only gets spawned pieces is reported; a hole there fixes it', () => {
  const base = {
    id: 99, width: 5, height: 5, colors: 4, moves: 20, difficulty: 'normal', stars: [1, 2, 3],
    goals: [{ type: 'score', target: 100 }], portals: [{ from: [1, 0], to: [3, 4] }],
  };
  const bad = lintLevel(parseLevel(base));
  assert.equal(bad.length, 1);
  assert.match(bad[0]!, /cell 2,0: pieces appear out of nowhere/);
  const fixed = parseLevel({ ...base, shape: ['#####', '#####', '_####', '#####', '#####'] });
  assert.deepEqual(lintLevel(fixed), []);
});
