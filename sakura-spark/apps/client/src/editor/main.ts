/**
 * Редактор уровней (ROADMAP, этап 17): /editor.html. Кисти по слоям (форма, желе, блокеры, порталы),
 * цели, проверка ядром и линтом на лету, раскладка по сиду, бот-тест в фоне, экспорт JSON в формате levels/.
 * Файл уровня кладётся в levels/NNNN.json; ходы и звёзды точнее подберёт `npm run tune`.
 */
import { gameOptionsFromLevel, Match3Game } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import type { LevelReport } from '../../../../packages/sim/src/autotest.ts';
import { formatLevel } from '../../../../packages/sim/src/tune.ts';
import { BRUSHES, blankLevel, cell, check, paint, portals, portalTap, resize } from './model.ts';
import type { Layer, Raw } from './model.ts';

const files = import.meta.glob<unknown>('../../../../levels/*.json', { eager: true, import: 'default' });
const bundled = Object.values(files).map((j) => j as Raw).sort((a, b) => Number(a.id) - Number(b.id));

const PIECE = ['#ff6f91', '#ffb03b', '#4fc3f7', '#7ed957', '#b388ff', '#ffe066'];
const BLOCKER_VIEW: Record<string, { bg: string; text: string }> = {
  i: { bg: '#cdeeff', text: '❄' }, I: { bg: '#8fd3ff', text: '❄❄' }, f: { bg: '#5d4a7a', text: '☁' },
  k: { bg: '#d9a35b', text: '▣' }, K: { bg: '#a8732f', text: '▣▣' }, m: { bg: '#fff0f5', text: '●' }, M: { bg: '#ffd6e6', text: '●●' },
  v: { bg: 'transparent', text: '⌇' },
};

let raw: Raw = structuredClone(bundled.at(-1) ?? blankLevel(1));
let layer: Layer = 'blockers';
let brush = 'i';
let pending: [number, number] | null = null;
let seed = 1;
let botResult: string = '';
const worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });

const app = document.getElementById('app')!;
/** Элемент DOM: свойства (style — строкой) и дети. */
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  const { style, ...rest } = props;
  Object.assign(el, rest);
  if (typeof style === 'string') el.setAttribute('style', style);
  el.append(...kids);
  return el;
};
const num = (label: string, value: number, min: number, max: number, on: (v: number) => void) => h('label', {}, label,
  h('input', { type: 'number', value: String(value), min: String(min), max: String(max), onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value)) }));

function update(next: Raw): void {
  raw = next;
  render();
}

function render(): void {
  const c = check(raw);
  app.replaceChildren(header(), h('div', { style: 'display:grid;gap:12px' }, boardSection(), goalsSection()), h('div', { style: 'display:grid;gap:12px' }, statusSection(c), previewSection(c.level), exportSection()));
}

function header(): HTMLElement {
  const pick = h('select', {
    onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      pending = null;
      botResult = '';
      update(v === 'new' ? blankLevel((Number(bundled.at(-1)?.id) || 0) + 1) : structuredClone(bundled.find((l) => String(l.id) === v)!));
    },
  }, h('option', { value: 'new' }, 'Новый уровень'), ...bundled.map((l) => h('option', { value: String(l.id), selected: l.id === raw.id }, `Уровень ${l.id}`)));
  return h('header', {}, h('h1', {}, '🌸 Редактор уровней'), pick,
    num('id', Number(raw.id), 1, 9999, (v) => update({ ...raw, id: v })),
    num('ширина', raw.width, 5, 9, (v) => update(resize(raw, v, raw.height))),
    num('высота', raw.height, 5, 9, (v) => update(resize(raw, raw.width, v))),
    num('цветов', Number(raw.colors), 3, 6, (v) => update({ ...raw, colors: v })),
    num('ходов', Number(raw.moves), 1, 500, (v) => update({ ...raw, moves: v })),
    h('label', {}, 'сложность', h('select', { onchange: (e: Event) => update({ ...raw, difficulty: (e.target as HTMLSelectElement).value }) },
      ...['normal', 'hard', 'superHard'].map((d) => h('option', { value: d, selected: raw.difficulty === d }, d)))),
    h('label', {}, 'секунд', h('input', {
      type: 'number', value: raw.timeLimit === undefined ? '' : String(raw.timeLimit), placeholder: 'без таймера',
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        const { timeLimit: _, ...rest } = raw;
        update((v ? { ...rest, timeLimit: Number(v) } : rest) as Raw);
      },
    })));
}

function boardSection(): HTMLElement {
  const tabs = h('div', { className: 'row tabs' }, ...(['shape', 'jelly', 'blockers', 'portals'] as const).map((l) => h('button', {
    className: l === layer ? 'on' : '', onclick: () => {
      layer = l;
      if (l !== 'portals') brush = BRUSHES[l][1]?.ch ?? BRUSHES[l][0]!.ch;
      pending = null;
      render();
    },
  }, { shape: 'Форма', jelly: 'Желе', blockers: 'Блокеры', portals: 'Порталы' }[l])));
  const brushes = layer === 'portals'
    ? h('div', { className: 'small' }, 'Тап — вход портала, второй тап — выход. Тап по концу портала удаляет его.')
    : h('div', { className: 'row brushes' }, ...BRUSHES[layer].map((b) => h('button', { className: b.ch === brush ? 'on' : '', onclick: () => { brush = b.ch; render(); } }, b.label)));

  const board = h('div', { className: 'board', style: `grid-template-columns: repeat(${raw.width}, 1fr)` });
  const ps = portals(raw);
  for (let r = 0; r < raw.height; r++) {
    for (let col = 0; col < raw.width; col++) {
      const hole = cell(raw, 'shape', r, col) === '_';
      const j = hole ? '0' : cell(raw, 'jelly', r, col);
      const el = h('div', { className: `cell${hole ? ' hole' : ''}${j === '1' ? ' j1' : j === '2' ? ' j2' : ''}${pending && pending[0] === r && pending[1] === col ? ' pending' : ''}` });
      const b = hole ? '.' : cell(raw, 'blockers', r, col);
      const v = BLOCKER_VIEW[b];
      if (v) el.append(h('div', { className: 'b', style: `background:${v.bg}` }, v.text));
      const pi = ps.findIndex((p) => p.from[0] === r && p.from[1] === col);
      const po = ps.findIndex((p) => p.to[0] === r && p.to[1] === col);
      if (pi >= 0 || po >= 0) el.append(h('span', { className: 'p' }, pi >= 0 ? `↓${pi + 1}` : `↑${po + 1}`));
      el.dataset.r = String(r);
      el.dataset.c = String(col);
      board.append(el);
    }
  }
  // рисование: тап или проведение пальцем
  let painting = false;
  const at = (e: PointerEvent): [number, number] | null => {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell') as HTMLElement | null;
    return t?.dataset.r ? [Number(t.dataset.r), Number(t.dataset.c)] : null;
  };
  const apply = (p: [number, number] | null) => {
    if (!p) return;
    if (layer === 'portals') {
      const s = portalTap(raw, pending, p[0], p[1]);
      pending = s.pending;
      update(s.raw);
    } else if (cell(raw, layer, p[0], p[1]) !== brush) {
      update(paint(raw, layer, p[0], p[1], brush));
    }
  };
  board.onpointerdown = (e) => {
    painting = layer !== 'portals';
    apply(at(e));
  };
  board.onpointermove = (e) => {
    if (painting) apply(at(e));
  };
  window.onpointerup = () => (painting = false);
  return h('section', {}, h('h2', {}, 'Поле'), tabs, brushes, board);
}

type GoalRaw = Record<string, unknown> & { type: string };
const GOAL_TYPES: Record<string, string> = { score: 'очки', jelly: 'всё желе', collect: 'собрать цвет', lanterns: 'фонарики', fog: 'убрать туман' };

function goalsSection(): HTMLElement {
  const goals = (raw.goals as GoalRaw[] | undefined) ?? [];
  const setGoals = (gs: GoalRaw[]) => {
    let next: Raw = { ...raw, goals: gs };
    const lanterns = gs.find((g) => g.type === 'lanterns');
    if (lanterns && !raw.lanterns) next = { ...next, lanterns: { total: Number(lanterns.count) || 2, maxOnBoard: 2, spawnChance: 0.6 } };
    if (!lanterns) {
      const { lanterns: _, ...rest } = next;
      next = rest as Raw;
    }
    update(next);
  };
  const rows = goals.map((g, i) => {
    const put = (patch: Record<string, unknown>) => setGoals(goals.map((x, j) => (j === i ? { ...x, ...patch } as GoalRaw : x)));
    const params: HTMLElement[] = [];
    if (g.type === 'score') params.push(num('очков', Number(g.target), 1, 1e6, (v) => put({ target: v })));
    if (g.type === 'collect') {
      params.push(h('label', {}, 'цвет', h('select', { onchange: (e: Event) => put({ color: Number((e.target as HTMLSelectElement).value) }) },
        ...PIECE.slice(0, Number(raw.colors)).map((col, k) => h('option', { value: String(k), selected: g.color === k, style: `color:${col}` }, `● ${k}`)))));
      params.push(num('штук', Number(g.count), 1, 999, (v) => put({ count: v })));
    }
    if (g.type === 'lanterns') params.push(num('штук', Number(g.count), 1, 20, (v) => {
      put({ count: v });
    }));
    return h('div', { className: 'goal' },
      h('select', { onchange: (e: Event) => put({ type: (e.target as HTMLSelectElement).value, target: 5000, color: 0, count: 20 }) },
        ...Object.entries(GOAL_TYPES).map(([t, label]) => h('option', { value: t, selected: g.type === t }, label))),
      ...params, h('button', { onclick: () => setGoals(goals.filter((_, j) => j !== i)) }, '✕'));
  });
  const stars = (raw.stars as number[] | undefined) ?? [1, 2, 3];
  const lanterns = raw.lanterns as { total: number; maxOnBoard: number; spawnChance: number } | undefined;
  return h('section', {}, h('h2', {}, 'Цели'), ...rows,
    h('div', { className: 'row' }, h('button', { onclick: () => setGoals([...goals, { type: 'collect', color: 0, count: 20 }]) }, '+ цель')),
    ...(lanterns ? [h('div', { className: 'row' }, 'Фонарики:',
      num('всего', lanterns.total, 1, 20, (v) => update({ ...raw, lanterns: { ...lanterns, total: v } })),
      num('на поле', lanterns.maxOnBoard, 1, 5, (v) => update({ ...raw, lanterns: { ...lanterns, maxOnBoard: v } })))] : []),
    h('div', { className: 'row' }, 'Звёзды:', ...stars.map((s, i) => num(`${i + 1}★`, s, 1, 1e6, (v) => update({ ...raw, stars: stars.map((x, j) => (j === i ? v : x)) })))));
}

function statusSection(c: ReturnType<typeof check>): HTMLElement {
  const msgs = h('div', { className: 'msgs' });
  if (c.errors.length === 0 && c.warnings.length === 0) msgs.append(h('div', { className: 'okc' }, '✓ Уровень корректен'));
  for (const e of c.errors) msgs.append(h('div', { className: 'bad' }, `✕ ${e}`));
  for (const w of c.warnings) msgs.append(h('div', { className: 'warn' }, `⚠ ${w}`));
  const runs = h('input', { type: 'number', value: '200', min: '20', max: '2000' });
  const run = h('button', {
    className: 'primary', disabled: !c.level, onclick: () => {
      botResult = 'Бот играет…';
      render();
      worker.onmessage = (e: MessageEvent<LevelReport>) => {
        const r = e.data;
        const pct = (x: number) => `${Math.round(x * 100)}%`;
        botResult = `Победы ${pct(r.winRate)} (95%: ${pct(r.ci95[0])}–${pct(r.ci95[1])}), цель ${pct(r.target.min)}–${pct(r.target.max)} — `
          + `${r.verdict === 'ok' ? 'в коридоре ✓' : r.verdict === 'too_hard' ? 'слишком сложно: добавь ходов' : 'слишком легко: убери ходы'}. `
          + `Звёзды 0/1/2/3: ${r.stars.join('/')}, ходов в запасе ${r.avgMovesLeftOnWin.toFixed(1)}, почти-победы ${pct(r.nearMissRate)}.`;
        render();
      };
      worker.postMessage({ raw, runs: Number(runs.value) });
    },
  }, 'Бот-тест');
  return h('section', {}, h('h2', {}, 'Проверка'), msgs, h('div', { className: 'row' }, run, runs, h('span', { className: 'small' }, 'прогонов, казуальный бот')),
    botResult ? h('div', {}, botResult) : '');
}

function previewSection(level: LevelDef | null): HTMLElement {
  const s = h('section', {}, h('h2', {}, 'Раскладка'));
  if (!level) return s;
  const game = new Match3Game(gameOptionsFromLevel(level, seed));
  const board = h('div', { className: 'board', style: `grid-template-columns: repeat(${level.width}, 1fr); max-width: 300px` });
  for (let r = 0; r < level.height; r++) {
    for (let c = 0; c < level.width; c++) {
      const p = game.board.get({ row: r, col: c });
      const hole = cell(raw, 'shape', r, c) === '_';
      board.append(h('div', { className: `cell${hole ? ' hole' : ''}` }, p ? h('div', { className: 'dot', style: `background:${p.color === null ? '#fff' : PIECE[p.color] ?? '#999'}` }) : ''));
    }
  }
  s.append(board, h('div', { className: 'row' }, h('button', { onclick: () => { seed++; render(); } }, 'Другой сид'), h('span', { className: 'small' }, `сид ${seed}`)));
  return s;
}

function exportSection(): HTMLElement {
  const json = formatLevel(raw);
  const area = h('textarea', { value: json });
  return h('section', {}, h('h2', {}, 'JSON'), area, h('div', { className: 'row' },
    h('button', { onclick: () => void navigator.clipboard?.writeText(json) }, 'Копировать'),
    h('button', {
      onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: `${String(raw.id).padStart(4, '0')}.json` });
        a.click();
      },
    }, 'Скачать'),
    h('button', {
      onclick: () => {
        try {
          update(JSON.parse(area.value) as Raw);
        } catch {
          alert('Это не JSON');
        }
      },
    }, 'Загрузить из поля')),
  h('div', { className: 'small' }, 'Файл — в levels/ под номером уровня; потом npm run tune подберёт ходы и звёзды, npm run autotest проверит коридор.'));
}

render();
