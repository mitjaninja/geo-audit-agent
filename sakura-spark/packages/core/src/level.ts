import type { Portal } from './blockers.ts';
import { Match3Game } from './game.ts';
import { isValidSwap } from './moves.ts';
import type { Swap } from './types.ts';
import type { GameOptions } from './game.ts';
import type { Goal, LanternRule } from './goals.ts';
import { MAX_COLORS, MAX_SIZE, MIN_COLORS } from './types.ts';

export type Difficulty = 'normal' | 'hard' | 'superHard';

/** Персонажи PRD, которые говорят в обучении и перед уровнями. */
export type Speaker = 'mika' | 'pon' | 'ren' | 'setsu';
const SPEAKERS: readonly string[] = ['mika', 'pon', 'ren', 'setsu'];

/** Реплика перед уровнем: знакомит с новой механикой. Коротко — PRD: «без длинных диалогов». */
export interface IntroLine {
  readonly speaker: Speaker;
  readonly text: string;
}

/** Обучающий первый ход: рука показывает этот свап, остальные ходы до него недоступны. Нужен layout. */
export interface Tutorial {
  readonly swap: Swap;
  readonly text: string;
}

/**
 * Уровень в JSON (levels/NNNN.json). Сервер отдаёт его клиенту без обновления приложения;
 * сид поля приходит отдельно, поэтому один уровень играется на разных раскладках.
 */
export interface LevelDef {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly moves: number;
  readonly difficulty: Difficulty;
  readonly goals: readonly Goal[];
  readonly stars: readonly [number, number, number];
  readonly shape?: readonly string[];
  readonly jelly?: readonly string[];
  readonly layout?: readonly string[];
  /** Блокеры: . нет, i/I лёд 1/2, f туман, k/K сундук 1/2, m/M дайфуку 1/2, v лианы. */
  readonly blockers?: readonly string[];
  /** В JSON: { "from": [row, col], "to": [row, col] }. */
  readonly portals?: readonly Portal[];
  readonly lanterns?: LanternRule;
  /** Секунды на уровень; тогда moves — скрытый предел ходов. */
  readonly timeLimit?: number;
  readonly intro?: readonly IntroLine[];
  readonly tutorial?: Tutorial;
}

export class LevelError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid level:\n- ${errors.join('\n- ')}`);
    this.name = 'LevelError';
  }
}

const DIFFICULTIES: readonly string[] = ['normal', 'hard', 'superHard'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function checkGrid(name: string, v: unknown, width: number, height: number, allowed: RegExp, errors: string[]): v is string[] {
  if (v === undefined) return false;
  if (!Array.isArray(v) || v.length !== height || v.some((r) => typeof r !== 'string' || r.length !== width)) {
    errors.push(`${name}: must be ${height} strings of length ${width}`);
    return false;
  }
  v.forEach((r: string, row) => {
    if (!allowed.test(r)) errors.push(`${name}: row ${row} has bad characters '${r}'`);
  });
  return true;
}

/**
 * Проверяет JSON уровня и возвращает типизированный LevelDef.
 * Собирает все ошибки сразу, чтобы геймдизайнер чинил файл за один заход.
 */
export function parseLevel(input: unknown): LevelDef {
  const errors: string[] = [];
  if (!isObj(input)) throw new LevelError(['level must be an object']);
  const { id, width, height, colors, moves, difficulty, goals, stars, shape, jelly, layout, lanterns, blockers, portals, timeLimit, intro, tutorial } = input;

  if (!isInt(id, 1, 1_000_000)) errors.push('id: integer ≥ 1');
  if (!isInt(width, 3, MAX_SIZE)) errors.push(`width: integer 3..${MAX_SIZE}`);
  if (!isInt(height, 3, MAX_SIZE)) errors.push(`height: integer 3..${MAX_SIZE}`);
  if (!isInt(colors, MIN_COLORS, MAX_COLORS)) errors.push(`colors: integer ${MIN_COLORS}..${MAX_COLORS}`);
  if (!isInt(moves, 1, 500)) errors.push('moves: integer 1..500');
  if (timeLimit !== undefined && !isInt(timeLimit, 15, 600)) errors.push('timeLimit: integer seconds 15..600');

  let introLines: IntroLine[] | undefined;
  if (intro !== undefined) {
    if (!Array.isArray(intro) || intro.length < 1 || intro.length > 4
      || !intro.every((l) => isObj(l) && SPEAKERS.includes(String(l.speaker)) && typeof l.text === 'string'
        && l.text.length >= 1 && l.text.length <= 160)) {
      errors.push(`intro: 1..4 lines of { speaker: ${SPEAKERS.join('|')}, text: 1..160 chars }`);
    } else {
      introLines = intro.map((l: { speaker: Speaker; text: string }) => ({ speaker: l.speaker, text: l.text }));
    }
  }
  let tutorialDef: Tutorial | undefined;
  if (tutorial !== undefined) {
    const cell = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n));
    const t = tutorial as { swap?: unknown; text?: unknown };
    if (!isObj(tutorial) || !Array.isArray(t.swap) || t.swap.length !== 2 || !t.swap.every(cell)
      || typeof t.text !== 'string' || t.text.length < 1 || t.text.length > 160) {
      errors.push('tutorial: { swap: [[row, col], [row, col]], text: 1..160 chars }');
    } else if (layout === undefined) {
      errors.push('tutorial needs a fixed layout');
    } else {
      const [[ar, ac], [br, bc]] = t.swap as [[number, number], [number, number]];
      tutorialDef = { swap: { a: { row: ar, col: ac }, b: { row: br, col: bc } }, text: t.text };
    }
  }
  if (typeof difficulty !== 'string' || !DIFFICULTIES.includes(difficulty)) errors.push(`difficulty: one of ${DIFFICULTIES.join(', ')}`);
  const st = stars as number[];
  if (!Array.isArray(stars) || st.length !== 3 || !st.every((s) => isInt(s, 1, 10_000_000))
    || !(st[0]! < st[1]! && st[1]! < st[2]!)) {
    errors.push('stars: three increasing positive integers');
  }
  if (errors.some((e) => /^(width|height|colors)/.test(e))) throw new LevelError(errors);
  const w = width as number;
  const h = height as number;

  const hasShape = checkGrid('shape', shape, w, h, /^[#_]+$/, errors);
  const hasJelly = checkGrid('jelly', jelly, w, h, /^[012_]+$/, errors);
  checkGrid('layout', layout, w, h, /^.*$/, errors);
  if (layout !== undefined && Array.isArray(layout)) {
    // посимвольный синтаксис layout проверит Board.fromStrings при создании партии
    if (hasShape) errors.push('layout and shape are exclusive: holes in layout are marked with _');
  }

  const holeAt = (row: number, col: number) => hasShape && (shape as string[])[row]![col] === '_';
  let jellyCells = 0;
  if (hasJelly) {
    (jelly as string[]).forEach((r, row) => [...r].forEach((ch, col) => {
      if (ch === '1' || ch === '2') {
        jellyCells++;
        if (holeAt(row, col)) errors.push(`jelly: layer on a hole at ${row},${col}`);
      }
    }));
  }
  const hasBlockers = checkGrid('blockers', blockers, w, h, /^[.iIfkKmMv_]+$/, errors);
  let fogCells = 0;
  if (hasBlockers) {
    (blockers as string[]).forEach((r, row) => [...r].forEach((ch, col) => {
      if (ch === 'f') fogCells++;
      if (ch !== '.' && ch !== '_' && holeAt(row, col)) errors.push(`blockers: blocker on a hole at ${row},${col}`);
    }));
  }

  const portalList: Portal[] = [];
  if (portals !== undefined) {
    const isCell = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2
      && isInt(v[0], 0, h - 1) && isInt(v[1], 0, w - 1);
    if (!Array.isArray(portals)) {
      errors.push('portals: array of { from: [row, col], to: [row, col] }');
    } else {
      portals.forEach((pt: unknown, i) => {
        if (!isObj(pt) || !isCell(pt.from) || !isCell(pt.to)) return errors.push(`portals[${i}]: from/to must be [row, col] on the board`);
        const [from, to] = [pt.from, pt.to].map(([row, col]) => ({ row, col })) as [Portal['from'], Portal['to']];
        if (holeAt(from.row, from.col) || holeAt(to.row, to.col)) errors.push(`portals[${i}]: end on a hole`);
        if (from.col === to.col) errors.push(`portals[${i}]: entrance and exit must be in different columns`);
        portalList.push({ from, to });
      });
    }
  }

  if (hasShape && (shape as string[]).join('').split('').filter((c) => c === '#').length < 9) {
    errors.push('shape: at least 9 playable cells');
  }

  let lanternRule: LanternRule | undefined;
  if (lanterns !== undefined) {
    if (!isObj(lanterns) || !isInt(lanterns.total, 1, 50) || !isInt(lanterns.maxOnBoard, 1, w)
      || typeof lanterns.spawnChance !== 'number' || !(lanterns.spawnChance > 0 && lanterns.spawnChance <= 1)) {
      errors.push(`lanterns: { total 1..50, maxOnBoard 1..${w}, spawnChance (0, 1] }`);
    } else {
      lanternRule = { total: lanterns.total, maxOnBoard: lanterns.maxOnBoard, spawnChance: lanterns.spawnChance };
    }
  }

  if (!Array.isArray(goals) || goals.length < 1 || goals.length > 3) {
    errors.push('goals: 1..3 goals');
  } else {
    const types = new Set<string>();
    goals.forEach((g: unknown, i) => {
      if (!isObj(g)) return errors.push(`goals[${i}]: must be an object`);
      const t = String(g.type);
      if (types.has(t) && t !== 'collect') errors.push(`goals[${i}]: duplicate goal type ${t}`);
      types.add(t);
      switch (g.type) {
        case 'score':
          if (!isInt(g.target, 1, 10_000_000)) errors.push(`goals[${i}].target: positive integer`);
          break;
        case 'jelly':
          if (jellyCells === 0) errors.push(`goals[${i}]: jelly goal needs a jelly grid with layers`);
          break;
        case 'lanterns':
          if (!isInt(g.count, 1, 50)) errors.push(`goals[${i}].count: integer 1..50`);
          else if (!lanternRule) errors.push(`goals[${i}]: lanterns goal needs a lanterns rule`);
          else if (lanternRule.total < g.count) errors.push(`goals[${i}]: lanterns.total ${lanternRule.total} < goal ${g.count}`);
          break;
        case 'fog':
          if (fogCells === 0) errors.push(`goals[${i}]: fog goal needs fog (f) in blockers`);
          break;
        case 'collect':
          if (!isInt(g.color, 0, (colors as number) - 1)) errors.push(`goals[${i}].color: 0..${(colors as number) - 1}`);
          if (!isInt(g.count, 1, 500)) errors.push(`goals[${i}].count: integer 1..500`);
          break;
        default:
          errors.push(`goals[${i}].type: one of score, jelly, lanterns, collect, fog`);
      }
    });
    if (lanternRule && !types.has('lanterns')) errors.push('lanterns rule without a lanterns goal');
  }

  if (errors.length > 0) throw new LevelError(errors);
  const level: LevelDef = {
    id: id as number, width: w, height: h, colors: colors as number, moves: moves as number,
    difficulty: difficulty as Difficulty,
    goals: (goals as Goal[]).map((g) => ({ ...g })) as Goal[],
    stars: [...(stars as number[])] as [number, number, number],
    ...(hasShape ? { shape: [...(shape as string[])] } : {}),
    ...(hasJelly ? { jelly: [...(jelly as string[])] } : {}),
    ...(Array.isArray(layout) ? { layout: [...(layout as string[])] } : {}),
    ...(hasBlockers ? { blockers: [...(blockers as string[])] } : {}),
    ...(portalList.length > 0 ? { portals: portalList } : {}),
    ...(lanternRule ? { lanterns: lanternRule } : {}),
    ...(timeLimit !== undefined ? { timeLimit: timeLimit as number } : {}),
    ...(introLines ? { intro: introLines } : {}),
    ...(tutorialDef ? { tutorial: tutorialDef } : {}),
  };
  // то, что видно только на собранном поле: петли порталов, фишки под блокерами в layout и т.п.
  let probe: Match3Game;
  try {
    probe = new Match3Game(gameOptionsFromLevel(level, 1));
  } catch (e) {
    throw new LevelError([`board: ${(e as Error).message}`]);
  }
  if (tutorialDef && !isValidSwap(probe.board, tutorialDef.swap)) throw new LevelError(['tutorial: swap is not a valid move on the layout']);
  return level;
}

export function gameOptionsFromLevel(level: LevelDef, seed: number): GameOptions {
  return {
    width: level.width, height: level.height, colors: level.colors, moves: level.moves, seed,
    goals: level.goals, stars: level.stars,
    ...(level.shape ? { shape: level.shape } : {}),
    ...(level.jelly ? { jelly: level.jelly } : {}),
    ...(level.layout ? { layout: level.layout } : {}),
    ...(level.blockers ? { blockers: level.blockers } : {}),
    ...(level.portals ? { portals: level.portals } : {}),
    ...(level.lanterns ? { lanterns: level.lanterns } : {}),
    ...(level.timeLimit !== undefined ? { timeLimit: level.timeLimit } : {}),
  };
}
