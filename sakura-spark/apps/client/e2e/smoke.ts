/**
 * Дымовой e2e-тест собранного клиента в настоящем Chromium против настоящего сервера
 * (SQLite в памяти, dev-вход). Онлайн: карта → уровень → свайп, тап-тап, доигрывание с проверкой
 * реплея сервером → на карту; выход через ✕; экран «жизни закончились». Офлайн: блокеры в тёмной
 * теме и таймер. Падает на любой ошибке страницы. Скриншоты — в SMOKE_OUT (по умолчанию e2e/out).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createApp } from '../../server/src/http.ts';
import { loadLevels } from '../../server/src/levels.ts';
import { GameService } from '../../server/src/service.ts';
import { SqliteStore } from '../../server/src/store.ts';

const OUT = resolve(process.env.SMOKE_OUT ?? new URL('./out', import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => existsSync(p));

const store = new SqliteStore(':memory:');
const service = new GameService({ store, levels: loadLevels(new URL('../../../levels', import.meta.url).pathname) });
const server = createApp({ service, botToken: '', devAuth: true, clientDir: new URL('../dist', import.meta.url).pathname });
await new Promise<void>((r) => server.listen(4173, r));
const base = 'http://localhost:4173/';
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });

const g = (page: Page, fn: string) => page.evaluate(`(() => { const s = globalThis.__sakura, m = globalThis.__sakuraMap, msg = globalThis.__sakuraMessage; return ${fn}; })()`);
const gameReady = (page: Page) => page.waitForFunction(() => {
  const s = (globalThis as any).__sakura;
  return s?.match && s.idle && !s.onboarding && s.scene.isActive();
});
const gameShown = (page: Page) => page.waitForFunction(() => (globalThis as any).__sakura?.match && (globalThis as any).__sakura.scene.isActive());
const mapReady = (page: Page) => page.waitForFunction(() => (globalThis as any).__sakuraMap?.scene.isActive());

async function open(query: string, colorScheme: 'light' | 'dark' = 'light', introsSeen = true): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
  const page = await ctx.newPage();
  // реплики и обучение уже «показаны» — кроме сценария, который проверяет именно их
  if (introsSeen) {
    await page.addInitScript(() => localStorage.setItem('sakura.intros', JSON.stringify(Array.from({ length: 100 }, (_, i) => i + 1))));
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // без сети: скрипт Telegram подменяем пустым — вне клиента Telegram он и так ничего не делает
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(base + query);
  return { page, errors };
}

/** Клик по точке canvas (device pixels) — переводим в CSS-пиксели страницы. */
async function clickCanvas(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.mouse.click(p.x / 2, p.y / 2);
}

async function tapLevelOnMap(page: Page, id: number, waitReady = true): Promise<void> {
  await mapReady(page);
  await g(page, `m.scrollTo(${id})`);
  await clickCanvas(page, (await g(page, `m.nodeOnScreen(${id})`)) as { x: number; y: number });
  if (waitReady) await gameReady(page);
  else await gameShown(page);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function clickDialog(page: Page, label: string): Promise<void> {
  await page.waitForFunction((l) => (globalThis as any).__sakura?.dialogButtons?.some((b: any) => b.label === l), label);
  await clickCanvas(page, (await g(page, `s.dialogButtons.find((b) => b.label === ${JSON.stringify(label)})`)) as { x: number; y: number });
}

const moves = (page: Page) => g(page, 's.match.movesLeft') as Promise<number>;
const cssCenter = (page: Page, row: number, col: number) =>
  g(page, `({ x: (s.layout.boardX + (${col} + 0.5) * s.layout.cell) / 2, y: (s.layout.boardY + (${row} + 0.5) * s.layout.cell) / 2 })`) as Promise<{ x: number; y: number }>;

try {
  console.log('online: map → level 1: Mika intro, tutorial move, idle hint, tap-tap, play to the end, back to map');
  {
    const { page, errors } = await open('?devUser=1', 'light', false);
    await mapReady(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/0-map-new.png` });
    await tapLevelOnMap(page, 1, false);
    // вступление Мики: две реплики, тап листает, ходы закрыты
    await page.waitForFunction(() => (globalThis as any).__sakura.onboarding);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/1-intro.png` });
    assert.equal(await g(page, 's.match.history.length'), 0);
    await page.mouse.click(195, 700);
    await page.waitForTimeout(250);
    await page.mouse.click(195, 700);
    await gameReady(page);
    // обучающий ход: другой ход не принимается, показанный — делаем свайпом
    const gate = (await g(page, 's.gate')) as any;
    assert.ok(gate, 'tutorial gate is set');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/1b-tutorial.png` });
    const before = await moves(page);
    const other = (await g(page, `s.match.validSwaps().find((w) => !(w.a.row === ${gate.a.row} && w.a.col === ${gate.a.col} && w.b.row === ${gate.b.row} && w.b.col === ${gate.b.col}) && !(w.a.row === ${gate.b.row} && w.a.col === ${gate.b.col} && w.b.row === ${gate.a.row} && w.b.col === ${gate.a.col}))`)) as any;
    if (other) {
      await drag(page, await cssCenter(page, other.a.row, other.a.col), await cssCenter(page, other.b.row, other.b.col));
      await page.waitForTimeout(400);
      assert.equal(await moves(page), before, 'only the shown move is allowed');
    }
    await drag(page, await cssCenter(page, gate.a.row, gate.a.col), await cssCenter(page, gate.b.row, gate.b.col));
    await page.waitForFunction((m) => (globalThis as any).__sakura.match.movesLeft === m - 1, before);
    await gameReady(page);
    assert.equal(await g(page, 's.gate'), null);
    // подсказка Пона после 7 секунд бездействия
    await page.waitForFunction(() => (globalThis as any).__sakura.hintObjects.length > 0, undefined, { timeout: 12_000 });
    await page.screenshot({ path: `${OUT}/1c-hint.png` });

    const swap2 = (await g(page, 's.match.validSwaps()[0]')) as any;
    await page.mouse.click(...Object.values(await cssCenter(page, swap2.a.row, swap2.a.col)) as [number, number]);
    await page.mouse.click(...Object.values(await cssCenter(page, swap2.b.row, swap2.b.col)) as [number, number]);
    await page.waitForFunction((m) => (globalThis as any).__sakura.match.movesLeft === m - 2, before);
    await gameReady(page);
    await page.screenshot({ path: `${OUT}/2-after-moves.png` });

    await page.evaluate(async () => {
      const s = (globalThis as any).__sakura;
      while (s.match.status === 'playing') await s.trySwap(s.match.validSwaps()[0]);
    });
    await page.waitForFunction(() => (globalThis as any).__sakura.dialogButtons.length > 0);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/3-result.png` });
    const status = await g(page, 's.match.status');
    const me = await service.me((await store.getUser(1))!);
    const names = (await store.getEvents(1)).map((e) => e.name);
    for (const n of ['install', 'session_start', 'level_start', 'tutorial_complete', 'hint_shown']) assert.ok(names.includes(n), `event ${n}`);
    console.log(`  finished: ${status}; server: maxLevel ${me.maxLevel}, lives ${me.lives.lives}, level 1 ${JSON.stringify(me.levels[1])}`);
    if (status === 'won') {
      assert.equal(me.maxLevel, 2);
      assert.equal(me.lives.lives, 5);
      assert.equal(me.levels[1]!.bestScore, await g(page, 's.match.score'), 'server replay gives the same score as the client');
    }
    await clickDialog(page, 'На карту');
    await mapReady(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/4-map-after-win.png` });
    if (status === 'won') {
      // второй уровень открыт с карты и начинается с реплики Пона про лучи
      await tapLevelOnMap(page, 2, false);
      await page.waitForFunction(() => (globalThis as any).__sakura.onboarding);
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('online: exit mid-level via ✕ costs a life and returns to the map');
  {
    const { page, errors } = await open('?devUser=3');
    await tapLevelOnMap(page, 1);
    const exit = (await g(page, '({ x: s.hud.exit.x, y: s.hud.exit.y })')) as { x: number; y: number };
    await clickCanvas(page, exit);
    await page.screenshot({ path: `${OUT}/5-exit-confirm.png` });
    await clickDialog(page, 'Выйти');
    await mapReady(page);
    assert.equal((await service.me((await store.getUser(3))!)).lives.lives, 4);
    assert.equal((await store.getOpenAttempt(3)), null, 'attempt closed');
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('online: no lives screen, then back on the map once lives return');
  {
    const first = await open('?devUser=2');
    await mapReady(first.page);
    await first.page.context().close();
    const user = (await store.getUser(2))!;
    await store.saveLives(2, { ...user.lives, lives: 0, updatedAt: Date.now() });
    const { page, errors } = await open('?devUser=2');
    await mapReady(page);
    await g(page, 'm.scrollTo(1)');
    await clickCanvas(page, (await g(page, 'm.nodeOnScreen(1)')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraMessage?.buttonCenter && (globalThis as any).__sakuraMessage.scene.isActive());
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/6-no-lives.png` });
    await store.saveLives(2, { lives: 5, updatedAt: Date.now(), infiniteUntil: 0 });
    const btn = (await g(page, 'msg.buttonCenter')) as { x: number; y: number };
    await clickCanvas(page, btn);
    await tapLevelOnMap(page, 1);
    assert.equal((await service.me((await store.getUser(2))!)).lives.lives, 4);
    assert.deepEqual(errors.filter((e) => !/status of 409/.test(e)), [], '409 no_lives is expected');
    await page.context().close();
  }

  console.log('offline, level 5: holes, blockers, portals, dark theme');
  {
    const { page, errors } = await open('?offline=1&level=5&seed=3', 'dark');
    await gameReady(page);
    await page.screenshot({ path: `${OUT}/7-level5-dark.png` });
    for (let i = 0; i < 6; i++) {
      await page.evaluate(async () => {
        const s = (globalThis as any).__sakura;
        if (s.match.status === 'playing') await s.trySwap(s.match.validSwaps()[0]);
      });
    }
    const consistent = await g(page, 's.match.board.playableCells().filter((p) => s.match.board.get(p)).length === s.sprites.size');
    assert.ok(consistent, 'sprites match the core board');
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('offline, timed level: timer follows the wall clock');
  {
    const timed = [...loadLevels(new URL('../../../levels', import.meta.url).pathname).values()].find((l) => l.timeLimit)!;
    const { page, errors } = await open(`?offline=1&level=${timed.id}&seed=2`);
    await gameReady(page);
    const t0 = (await g(page, 's.timeLeft')) as number;
    await page.waitForTimeout(1200);
    const t1 = (await g(page, 's.timeLeft')) as number;
    assert.ok(t1 < t0 - 1 && t1 > t0 - 1.6, `timer follows wall clock: ${t0} → ${t1}`);
    await g(page, 's.deadline = performance.now() + 50');
    await page.waitForFunction(() => (globalThis as any).__sakura.finished);
    assert.equal(await g(page, 's.match.status'), 'lost');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  console.log(`smoke OK, screenshots in ${OUT}`);
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
}
