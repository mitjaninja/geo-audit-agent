/**
 * Генератор уровней для контента 31+ (ROADMAP, этап 17). Детерминированный: id → тот же черновик.
 * Генератор отвечает за разнообразие (форма поля, блокеры, цели, кривая сложности), а число ходов,
 * пороги звёзд и цель по очкам уровней на время подбирает бот (tune) — черновик идёт с заглушками.
 *
 * Кривая (PRD «Экономика и сложность»): «пила» — каждый 10-й уровень сложный (…5), каждый 30-й — очень
 * сложный; изредка — уровень на время. Первый уровень района — со вступлением персонажей.
 */
import { lintLevel, parseLevel, Rng } from '@sakura/core';
import type { Difficulty, IntroLine } from '@sakura/core';
import { withI18n } from './intro-i18n.ts';

export const LEVELS_PER_EPISODE = 15;

export function difficultyFor(id: number): Difficulty {
  if (id % 30 === 0) return 'superHard';
  if (id % 10 === 5) return 'hard';
  return 'normal';
}

export const isTimed = (id: number) => id % 25 === 12;

/** Вступления первых уровней районов 3–14 (оригинальные тексты). */
const EPISODE_INTROS: Readonly<Record<number, readonly IntroLine[]>> = {
  3: [{ speaker: 'mika', text: 'Порт фонарей! Здесь корабли привозили огни со всего света.' }, { speaker: 'ren', text: 'Курогири спрятал их в трюмах. Поможешь достать?' }],
  4: [{ speaker: 'setsu', text: 'Зимний квартал. Лёд тут крепче, чем на реке, — бей дважды.' }],
  5: [{ speaker: 'mika', text: 'Небесный мост висит над облаками. Смотри под ноги — в нём дыры!' }],
  6: [{ speaker: 'pon', text: 'Сад фонтанов! Вода смывает туман, а мы смоем остальное.' }],
  7: [{ speaker: 'ren', text: 'Бамбуковая роща. Лианы тут растут быстрее, чем я плету фонари.' }],
  8: [{ speaker: 'mika', text: 'Квартал мастеров: здесь делают сундуки, которые не открыть одним ударом.' }],
  9: [{ speaker: 'setsu', text: 'Лунная гавань. Ночью фонари видно лучше — давай вернём их все.' }],
  10: [{ speaker: 'pon', text: 'Чайные холмы. Дайфуку тут повсюду — не объешься!' }],
  11: [{ speaker: 'ren', text: 'Звёздная башня. Порталы ведут с этажа на этаж.' }],
  12: [{ speaker: 'mika', text: 'Река огней. Каждый вернувшийся фонарь плывёт по ней домой.' }],
  13: [{ speaker: 'setsu', text: 'Императорский сад. Курогири рядом — я чувствую холод.' }],
  14: [{ speaker: 'mika', text: 'Сердце фестиваля! Ещё немного — и сакура снова зацветёт.' }],
};

type Grid = string[];
const fill = (w: number, h: number, ch: string): Grid => Array.from({ length: h }, () => ch.repeat(w));
const set = (g: Grid, r: number, c: number, ch: string) => {
  g[r] = g[r]!.slice(0, c) + ch + g[r]!.slice(c + 1);
};
const at = (g: Grid, r: number, c: number) => g[r]![c]!;

/** Форма поля: # — клетка, _ — дыра. Дыры не в верхнем ряду (сверху падают новые фишки). */
function makeShape(w: number, h: number, kind: number): Grid {
  const g = fill(w, h, '#');
  const mid = Math.floor(w / 2);
  switch (kind) {
    case 1: // срезанные нижние углы
      for (const [r, c] of [[h - 1, 0], [h - 1, w - 1], [h - 2, 0], [h - 1, 1], [h - 2, w - 1], [h - 1, w - 2]]) set(g, r!, c!, '_');
      break;
    case 2: // дыра в центре
      for (let r = Math.floor(h / 2) - 1; r <= Math.floor(h / 2); r++) for (const c of [mid - 1, mid]) set(g, r, c, '_');
      break;
    case 3: // выемки по бокам
      for (let r = 3; r < h - 2; r++) {
        set(g, r, 0, '_');
        set(g, r, w - 1, '_');
      }
      break;
    case 4: { // ромб: узкий низ
      for (let r = h - 3; r < h; r++) {
        const cut = r - (h - 3) + 1;
        for (let c = 0; c < cut; c++) {
          set(g, r, c, '_');
          set(g, r, w - 1 - c, '_');
        }
      }
      break;
    }
    default:
      break;
  }
  return g;
}

/** Порталы над поясом дыр: фишки «перепрыгивают» дыру крест-накрест (как в уровне 17). */
function addPortalBand(shape: Grid, w: number, h: number): { from: [number, number]; to: [number, number] }[] {
  const r = Math.floor(h / 2);
  const c = Math.floor(w / 2) - 1;
  set(shape, r, c, '_');
  set(shape, r, c + 1, '_');
  return [{ from: [r - 1, c], to: [r + 1, c + 1] }, { from: [r - 1, c + 1], to: [r + 1, c] }];
}

const playable = (shape: Grid, r: number, c: number) => at(shape, r, c) === '#';

interface Draft {
  id: number;
  width: number;
  height: number;
  colors: number;
  moves: number;
  difficulty: Difficulty;
  timeLimit?: number;
  shape?: Grid;
  jelly?: Grid;
  blockers?: Grid;
  portals?: { from: [number, number]; to: [number, number] }[];
  lanterns?: { total: number; maxOnBoard: number; spawnChance: number };
  goals: Record<string, unknown>[];
  intro?: readonly IntroLine[];
  stars: [number, number, number];
}

/** Черновик уровня id (ходы и звёзды — заглушки до tune). attempt — другая попытка, если черновик не прошёл проверку. */
export function draftLevel(id: number, attempt = 0): Draft {
  const rng = new Rng(id * 7919 + attempt * 104_729 + 17);
  const episode = Math.ceil(id / LEVELS_PER_EPISODE);
  const difficulty = difficultyFor(id);
  const hard = difficulty !== 'normal';
  const size = rng.next() < 0.6 ? 9 : 8;
  const w = size;
  const h = size === 8 && rng.next() < 0.3 ? 9 : size;
  const colors = id > 80 && rng.next() < 0.2 ? 6 : 5;
  const draft: Draft = { id, width: w, height: h, colors, moves: 30, difficulty, goals: [], stars: [1, 2, 3] };
  const firstOfEpisode = (id - 1) % LEVELS_PER_EPISODE === 0;
  if (firstOfEpisode && EPISODE_INTROS[episode]) draft.intro = EPISODE_INTROS[episode]!.map(withI18n);

  if (isTimed(id)) {
    // на время: счёт за 60–90 секунд, цель по очкам подберёт бот (tuneTimed)
    draft.timeLimit = 60 + 15 * rng.int(3);
    draft.moves = 300;
    draft.goals = [{ type: 'score', target: 5000 }];
    draft.intro = draft.intro ?? [withI18n({ speaker: 'ren' as const, text: 'Фестивальный забег: набери очки, пока горят песочные часы!' })];
    return draft;
  }

  // форма: чаще полная, иногда фигурная; порталы — с района 3, примерно в каждом шестом уровне
  const shape = makeShape(w, h, rng.next() < 0.45 ? 0 : 1 + rng.int(4));
  const portals = rng.next() < 0.17 ? addPortalBand(shape, w, h) : undefined;
  if (shape.some((r) => r.includes('_'))) draft.shape = shape;
  if (portals) draft.portals = portals;

  const blockers = fill(w, h, '.');
  const put = (r: number, c: number, ch: string) => {
    if (r > 0 && playable(shape, r, c) && !(portals ?? []).some((p) => (p.from[0] === r && p.from[1] === c) || (p.to[0] === r && p.to[1] === c))) set(blockers, r, c, ch);
  };
  const strong = hard || rng.next() < 0.3;

  // шаблон цели по району: у каждого района свой любимый, остальные — реже
  const templates = ['jelly', 'collect', 'fog', 'lanterns', 'jellyCollect', 'score'] as const;
  // веса: «просто очки» — редкость, это самая скучная цель
  const weighted = ['jelly', 'jelly', 'jelly', 'collect', 'collect', 'collect', 'fog', 'fog', 'lanterns', 'lanterns', 'jellyCollect', 'jellyCollect', 'score'] as const;
  const favourite = templates[(episode + 1) % 4]!;
  const kind = rng.next() < 0.3 ? favourite : weighted[rng.int(weighted.length)]!;

  // препятствие: лёд рядами, сундуки, дайфуку, лианы
  const obstacle = rng.int(5);
  const row0 = 2 + rng.int(Math.max(1, h - 5));
  if (obstacle === 0 || obstacle === 4) for (let c = 0; c < w; c++) put(row0, c, strong ? 'I' : 'i');
  if (obstacle === 1) {
    const cc = 1 + rng.int(w - 3);
    for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) put(row0 + dr!, cc + dc!, strong ? 'K' : 'k');
  }
  // дайфуку бьются только спецфишками: на желе и в тумане они делают цель почти невыполнимой (уровни 90–192
  // первого прогона) — ставим их только к целям «собрать» и «очки»
  if (obstacle === 2 && (kind === 'collect' || kind === 'score')) for (let i = 0; i < 4 + rng.int(4); i++) put(1 + rng.int(h - 2), rng.int(w), strong ? 'M' : 'm');
  if (obstacle === 3 && kind !== 'lanterns') for (let c = 1; c < w - 1; c++) put(h - 1, c, 'v');

  switch (kind) {
    case 'jelly':
    case 'jellyCollect': {
      const jelly = fill(w, h, '0');
      const top = Math.floor(h / 2) - (hard ? 2 : 0);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        if (!playable(shape, r, c)) set(jelly, r, c, '_');
        else if (r >= top) set(jelly, r, c, strong && r >= h - 3 ? '2' : '1');
      }
      draft.jelly = jelly;
      draft.goals = [{ type: 'jelly' }];
      if (kind === 'jellyCollect') draft.goals.push({ type: 'collect', color: rng.int(colors), count: 15 + Math.min(20, Math.floor(id / 10)) });
      break;
    }
    case 'collect': {
      const n = 1 + rng.int(hard ? 3 : 2);
      const picks = rng.shuffle([...Array(colors).keys()]).slice(0, n);
      const count = 18 + Math.min(22, Math.floor(id / 8)) + (hard ? 6 : 0);
      draft.goals = picks.map((color) => ({ type: 'collect', color, count: n === 1 ? count + 10 : count }));
      break;
    }
    case 'fog': {
      // туман снизу: 2–4 ряда, по краям — реже
      const rows = (hard ? 4 : 2) + rng.int(2);
      for (let r = h - rows; r < h; r++) for (let c = 0; c < w; c++) if (rng.next() < 0.8) put(r, c, 'f');
      draft.goals = [{ type: 'fog' }];
      break;
    }
    case 'lanterns': {
      // фонарикам нужен свободный низ — лиан нет (см. выше), лёд не в нижнем ряду
      const total = 2 + rng.int(hard ? 3 : 2);
      draft.lanterns = { total, maxOnBoard: 2, spawnChance: 0.55 };
      draft.goals = [{ type: 'lanterns', count: total }];
      if (rng.next() < 0.3) {
        for (let r = h - 2; r < h; r++) for (let c = 0; c < w; c++) if (rng.next() < 0.6) put(r, c, 'f');
        draft.goals.push({ type: 'fog' });
      }
      break;
    }
    case 'score':
      draft.goals = [{ type: 'score', target: 8000 + id * 60 + (hard ? 3000 : 0) }];
      break;
  }
  if (blockers.some((r) => /[^.]/.test(r))) draft.blockers = blockers;
  return draft;
}

/** Черновик, который проходит валидатор ядра и линт (иначе — следующая попытка). */
export function generateLevel(id: number): Draft {
  for (let attempt = 0; attempt < 50; attempt++) {
    const d = draftLevel(id, attempt);
    try {
      const level = parseLevel(d);
      if (lintLevel(level).length === 0) return d;
    } catch {
      // черновик с ошибкой (например, цель «туман» без тумана) — пробуем другой
    }
  }
  throw new Error(`level ${id}: no valid draft in 50 attempts`);
}
