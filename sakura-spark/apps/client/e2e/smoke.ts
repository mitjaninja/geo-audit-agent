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

const startReady = (page: Page) => page.waitForFunction(() => (globalThis as any).__sakuraStart?.scene.isActive() && (globalThis as any).__sakuraStart.buttons.length > 0);

/** Экран старта уровня: выбрать бустеры (по названию предмета) и нажать «Играть». */
async function startLevel(page: Page, boosters: string[] = []): Promise<void> {
  await startReady(page);
  for (const item of boosters) {
    await clickCanvas(page, (await g(page, `globalThis.__sakuraStart.toggles.find((x) => x.item === ${JSON.stringify(item)})`)) as { x: number; y: number });
    await page.waitForTimeout(150);
  }
  await clickCanvas(page, (await g(page, `globalThis.__sakuraStart.buttons.find((b) => b.label === 'Играть')`)) as { x: number; y: number });
}

async function tapLevelOnMap(page: Page, id: number, waitReady = true, boosters: string[] = []): Promise<void> {
  await mapReady(page);
  await g(page, `m.scrollTo(${id})`);
  await clickCanvas(page, (await g(page, `m.nodeOnScreen(${id})`)) as { x: number; y: number });
  await startLevel(page, boosters);
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

    // доигрываем как разумный игрок: ход, снимающий больше всего фишек (примерка на копии)
    await page.evaluate(async () => {
      const s = (globalThis as any).__sakura;
      while (s.match.status === 'playing') {
        let best = s.match.validSwaps()[0];
        let bestValue = -1;
        for (const w of s.match.validSwaps()) {
          const step = s.match.clone(7).swap(w).events.find((e: any) => e.type === 'cascade');
          const value = step ? step.step.cleared.length + step.step.created.length * 3 : 0;
          if (value > bestValue) [best, bestValue] = [w, value];
        }
        await s.trySwap(best);
      }
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

  console.log('chat room: link → room screen → free attempt with newcomer hints → place in chat → ranking');
  {
    await service.login({ id: 10, firstName: 'Мика' });
    const room = await service.createRoom(10, 'challenge');
    const { page, errors } = await open(`?devUser=11&room=${room.id}`, 'light', false);
    await page.waitForFunction(() => (globalThis as any).__sakuraRoom?.scene.isActive() && (globalThis as any).__sakuraRoom.buttons.length > 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/8-room.png` });
    const play = (await g(page, 'globalThis.__sakuraRoom.buttons[0]')) as { label: string; x: number; y: number };
    assert.equal(play.label, 'Играть — бесплатно');
    await clickCanvas(page, play);
    await startLevel(page);
    await gameReady(page);
    assert.equal(await g(page, 's.onboarding'), false, 'no intro in a chat room');
    assert.equal(await g(page, 's.match.options.seed'), room.seed, 'same seed as everyone in the chat');
    // новичок: подсказка появляется почти сразу
    await page.waitForFunction(() => (globalThis as any).__sakura.hintObjects.length > 0, undefined, { timeout: 3000 });
    await page.evaluate(async () => {
      const s = (globalThis as any).__sakura;
      while (s.match.status === 'playing') {
        let best = s.match.validSwaps()[0];
        let bestValue = -1;
        for (const w of s.match.validSwaps()) {
          const step = s.match.clone(7).swap(w).events.find((e: any) => e.type === 'cascade');
          const value = step ? step.step.cleared.length + step.step.created.length * 3 : 0;
          if (value > bestValue) [best, bestValue] = [w, value];
        }
        await s.trySwap(best);
      }
    });
    await page.waitForFunction(() => (globalThis as any).__sakura.dialogButtons.some((b: any) => b.label === 'К рейтингу'));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/9-room-result.png` });
    const view = await service.roomView(room.id, 11);
    assert.equal(view.players, 1, 'the server accepted the replay (moves at human speed)');
    assert.equal(view.me.place, 1);
    await clickDialog(page, 'К рейтингу');
    await page.waitForFunction(() => (globalThis as any).__sakuraRoom?.scene.isActive() && (globalThis as any).__sakuraRoom.buttons.length > 0);
    assert.equal(await g(page, 'globalThis.__sakuraRoom.buttons[0].label'), 'Играть · ♥ 1', 'the next attempt costs a life');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/10-room-ranking.png` });
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('map: «В чат» outside Telegram explains where sharing works');
  {
    const { page, errors } = await open('?devUser=12');
    await mapReady(page);
    await clickCanvas(page, (await g(page, 'm.shareButton')) as { x: number; y: number });
    // сначала выбор режима: челлендж, командный фонарь, дуэль
    await page.waitForFunction(() => (globalThis as any).__sakuraChoice?.scene.isActive() && (globalThis as any).__sakuraChoice.buttons.length === 4);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/24-chat-modes.png` });
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraChoice.buttons.find((b) => b.label.includes("Дуэль"))')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraMessage?.scene.isActive());
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('chat modes: team lantern progress and a duel accepted from the chat link');
  {
    await service.login({ id: 40, firstName: 'Пон' });
    await service.login({ id: 41, firstName: 'Сэцу' });
    const team = await service.createRoom(40, 'team');
    (store as any).db.prepare('UPDATE rooms SET progress = 900 WHERE id = ?').run(team.id);
    const duel = await service.createRoom(40, 'duel');
    const { page, errors } = await open(`?devUser=41&room=${team.id}`);
    const roomReady = () => page.waitForFunction(() => (globalThis as any).__sakuraRoom?.scene.isActive() && (globalThis as any).__sakuraRoom.buttons.length > 0);
    await roomReady();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/25-team-room.png` });
    await page.goto(`http://localhost:4173/?devUser=41&room=${duel.id}`);
    await roomReady();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/26-duel-room.png` });
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraRoom.buttons.find((b) => b.label === "Принять вызов")')) as { x: number; y: number });
    await startLevel(page);
    await gameReady(page);
    assert.deepEqual((await store.roomPlayers(duel.id)), [41]);
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
    await startLevel(page);
    await page.waitForFunction(() => (globalThis as any).__sakuraMessage?.buttonCenter && (globalThis as any).__sakuraMessage.scene.isActive());
    assert.ok(await g(page, 'msg.secondaryCenter'), '«ask for a life in chat» is offered');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/6-no-lives.png` });
    // «Все жизни · 12 💎»: кристаллы есть — жизни полные, снова экран старта уровня
    await store.transact(2, (w) => ({ crystals: w.crystals + 12 }));
    await clickCanvas(page, (await g(page, 'msg.buttonCenter')) as { x: number; y: number });
    await mapReady(page);
    assert.equal((await service.me((await store.getUser(2))!)).lives.lives, 5);
    assert.equal((await store.getWallet(2)).crystals, 0);
    await tapLevelOnMap(page, 1);
    assert.equal((await service.me((await store.getUser(2))!)).lives.lives, 4);
    assert.deepEqual(errors.filter((e) => !/status of 409/.test(e)), [], '409 no_lives is expected');
    await page.context().close();
  }

  console.log('economy: start booster, Pon\'s hammer, +5 moves for crystals, give up; shop outside Telegram');
  {
    await service.login({ id: 20, firstName: 'Рэн' });
    // сразу открыть сложный уровень 25 и дать кристаллов — проигрыш по ходам почти гарантирован
    (store as any).db.prepare('UPDATE users SET max_level = 25 WHERE id = 20').run();
    await store.transact(20, (w) => ({ crystals: w.crystals + 100 }));
    await service.claimLogin(20); // календарь входа не открывается сам — сценарий про экономику
    const { page, errors } = await open('?devUser=20');
    await mapReady(page);
    await page.screenshot({ path: `${OUT}/11-map-wallet.png` });
    await g(page, 'm.scrollTo(25)');
    await clickCanvas(page, (await g(page, 'm.nodeOnScreen(25)')) as { x: number; y: number });
    await startReady(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/12-start.png` });
    await startLevel(page, ['beamBomb']);
    await gameReady(page);
    const specials = (await g(page, 's.match.board.grid.flat().filter((p) => p && p.special !== "none" && p.special !== "lantern").length')) as number;
    assert.ok(specials >= 2, 'beam and bomb are on the board');
    // молот из панели: нажать кнопку, потом фишку
    const hammer = (await g(page, 's.bar.find((b) => b.item === "hammer")')) as { x: number; y: number };
    await clickCanvas(page, hammer);
    assert.equal(await g(page, 's.armed'), 'hammer');
    const cell = (await g(page, 's.match.board.playableCells().find((p) => { const x = s.match.board.get(p); return x && x.special === "none"; })')) as { row: number; col: number };
    const c = await cssCenter(page, cell.row, cell.col);
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction(() => (globalThis as any).__sakura.match.history.some((m: any) => m.booster === 'hammer'));
    await gameReady(page);
    // доигрываем первым ходом до проигрыша по ходам → окно «+5 ходов»
    await page.evaluate(async () => {
      const s = (globalThis as any).__sakura;
      while (s.match.status === 'playing') await s.trySwap(s.match.validSwaps()[0]);
    });
    await page.waitForFunction(() => (globalThis as any).__sakura.dialogButtons.some((b: any) => b.label.startsWith('+5')));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/13-extend.png` });
    await clickDialog(page, '+5 ходов · 9 💎');
    await page.waitForFunction(() => (globalThis as any).__sakura.match.movesLeft === 5);
    assert.equal((await store.getWallet(20)).crystals, 91);
    await page.evaluate(async () => {
      const s = (globalThis as any).__sakura;
      while (s.match.status === 'playing') await s.trySwap(s.match.validSwaps()[0]);
    });
    await page.waitForFunction(() => (globalThis as any).__sakura.dialogButtons.some((b: any) => b.label === 'Сдаться' || b.label === 'На карту'));
    if (await g(page, 's.dialogButtons.some((b) => b.label === "Сдаться")')) {
      assert.ok(await g(page, 's.dialogButtons.some((b) => b.label === "+5 ходов · 15 💎")'), 'the second extension costs 15');
      await clickDialog(page, 'Сдаться');
    }
    await page.waitForFunction(() => (globalThis as any).__sakura.dialogButtons.some((b: any) => b.label === 'На карту'));
    const w = await store.getWallet(20);
    assert.equal(w.items.beamBomb, 2, 'start booster taken');
    assert.equal(w.items.hammer, 2, 'hammer taken at finish after the server replay');
    const events = (await store.getEvents(20)).map((e) => e.name);
    for (const n of ['booster_used', 'moves_offer_shown', 'moves_purchased', 'level_fail']) assert.ok(events.includes(n), `event ${n}`);
    await clickDialog(page, 'На карту');
    await mapReady(page);
    // магазин вне Telegram: витрина есть, оплата объясняет, где работает
    await clickCanvas(page, (await g(page, 'm.shopButton')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraShop?.scene.isActive());
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/14-shop.png` });
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraShop.buttons.find((b) => b.label === "225 ⭐")')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraShop.status?.text?.includes('Telegram'));
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraShop.buttons.find((b) => b.label === "Закрыть")')) as { x: number; y: number });
    await mapReady(page);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('meta: login calendar opens by itself, chest of the district, daily tasks, wheel with odds');
  {
    await service.login({ id: 21, firstName: 'Сэцу' });
    const db = (store as any).db;
    db.prepare('UPDATE users SET max_level = 16 WHERE id = 21').run();
    for (let l = 1; l <= 15; l++) db.prepare('INSERT INTO level_progress (user_id, level_id, best_score, stars, wins) VALUES (21, ?, 1, ?, 1)').run(l, l <= 11 ? 3 : 0);
    const { page, errors } = await open('?devUser=21');
    const dailyReady = () => page.waitForFunction(() => (globalThis as any).__sakuraDaily?.scene.isActive() && (globalThis as any).__sakuraDaily.buttons.length > 0);
    const dailyButton = (label: string) => g(page, `globalThis.__sakuraDaily.buttons.find((b) => b.label === ${JSON.stringify(label)})`) as Promise<{ x: number; y: number }>;
    await dailyReady();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/15-daily.png` });
    await clickCanvas(page, await dailyButton('Забрать награду'));
    await page.waitForFunction(() => (globalThis as any).__sakuraDaily?.scene.isActive() && !(globalThis as any).__sakuraDaily.buttons.some((b: any) => b.label === 'Забрать награду'));
    assert.equal((await store.getWallet(21)).items.shuffle, 4, 'day 1: shuffle');
    await dailyReady();
    await clickCanvas(page, await dailyButton('30 ★'));
    await page.waitForTimeout(500);
    await dailyReady();
    assert.equal((await store.getWallet(21)).crystals, 2, 'chest 30 opened');
    await page.screenshot({ path: `${OUT}/16-daily-claimed.png` });
    await clickCanvas(page, await dailyButton('Закрыть'));
    await mapReady(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/17-map-meta.png` });
    await clickCanvas(page, (await g(page, 'm.wheelButton')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraWheel?.scene.isActive() && (globalThis as any).__sakuraWheel.buttons.length > 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/18-wheel.png` });
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraWheel.buttons.find((b) => b.label === "Крутить бесплатно")')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraWheel?.scene.isActive() && (globalThis as any).__sakuraWheel.buttons.some((b: any) => b.label.startsWith('Ещё спин')), undefined, { timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/19-wheel-after.png` });
    assert.ok((await store.getEvents(21)).some((e) => e.name === 'wheel_spin'));
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraWheel.buttons.find((b) => b.label === "Закрыть")')) as { x: number; y: number });
    await mapReady(page);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('social: friends on the map, mail, gift a life, friends ranking on a level, district gate with keys');
  {
    await service.login({ id: 30, firstName: 'Мика' });
    await service.login({ id: 31, firstName: 'Рэн' });
    await service.claimLogin(30);
    await service.befriend(30, 31, 'room');
    const db = (store as any).db;
    db.prepare('UPDATE users SET max_level = 16 WHERE id = 30').run();
    db.prepare('UPDATE users SET max_level = 12 WHERE id = 31').run();
    for (const [u, score] of [[30, 4200], [31, 5100]]) {
      db.prepare('INSERT INTO level_progress (user_id, level_id, best_score, stars, wins) VALUES (?, 15, ?, 2, 1)').run(u, score);
    }
    // игрок только что дошёл до района 2 — ворота закрыты
    await store.transact(30, (w) => ({ meta: { ...w.meta, gates: { 2: { reachedAt: Date.now(), keys: [] } } } }));
    await service.sendLife(31, 30);
    await store.saveLives(30, { lives: 3, updatedAt: Date.now(), infiniteUntil: 0 });
    const { page, errors } = await open('?devUser=30');
    await mapReady(page);
    await g(page, 'm.scrollTo(13)');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/20-map-friends.png` });
    // рейтинг друзей на уровне 15
    await clickCanvas(page, (await g(page, 'm.nodeOnScreen(15)')) as { x: number; y: number });
    await startReady(page);
    await page.waitForFunction(() => (globalThis as any).__sakuraStart.children.list.some((o: any) => o.text?.startsWith('🏆')));
    await page.screenshot({ path: `${OUT}/21-start-friends.png` });
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraStart.buttons.find((b) => b.label === "На карту")')) as { x: number; y: number });
    await mapReady(page);
    // друзья: принять жизнь, подарить в ответ
    await clickCanvas(page, (await g(page, 'm.friendsButton')) as { x: number; y: number });
    const friendsReady = () => page.waitForFunction(() => (globalThis as any).__sakuraFriends?.scene.isActive() && (globalThis as any).__sakuraFriends.buttons.length > 0);
    const friendsButton = (label: string) => g(page, `globalThis.__sakuraFriends.buttons.find((b) => b.label === ${JSON.stringify(label)})`) as Promise<{ x: number; y: number }>;
    await friendsReady();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/22-friends.png` });
    await clickCanvas(page, await friendsButton('Принять'));
    await page.waitForFunction(() => !(globalThis as any).__sakuraFriends.buttons.some((b: any) => b.label === 'Принять'));
    assert.equal((await store.getUser(30))!.lives.lives, 4);
    await friendsReady();
    await clickCanvas(page, await friendsButton('❤ Подарить'));
    await page.waitForFunction(() => (globalThis as any).__sakuraFriends.buttons.some((b: any) => b.label === '✓ ❤'));
    assert.equal((await store.inbox(31, 10))[0]?.kind, 'life');
    await friendsReady();
    await clickCanvas(page, await friendsButton('Закрыть'));
    await mapReady(page);
    // уровень 16 за воротами района
    await g(page, 'm.scrollTo(16)');
    await clickCanvas(page, (await g(page, 'm.nodeOnScreen(16)')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraGate?.scene.isActive() && (globalThis as any).__sakuraGate.buttons.length > 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/23-gate.png` });
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraGate.buttons.find((b) => b.label === "Попросить ключи")')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraGate?.scene.isActive() && (globalThis as any).__sakuraGate.children.list.some((o: any) => o.text?.includes('Попросили')));
    assert.equal((await store.inbox(31, 10)).some((m) => m.kind === 'ask_key'), true);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('events: win streak gives free start boosters; lantern race from the map');
  {
    await service.login({ id: 50, firstName: 'Мика' });
    await service.claimLogin(50);
    await store.transact(50, (w) => ({ meta: { ...w.meta, streak: 2 } }));
    const { page, errors } = await open('?devUser=50');
    await mapReady(page);
    await clickCanvas(page, (await g(page, 'm.nodeOnScreen(1)')) as { x: number; y: number });
    await startReady(page);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/28-streak.png` });
    await startLevel(page);
    await gameReady(page);
    const specials = (await g(page, 's.match.board.grid.flat().filter((p) => p && (p.special === "rainbow")).length')) as number;
    assert.ok(specials >= 1, 'streak 2 puts a rainbow on the board');
    assert.equal((await store.getWallet(50)).items.rainbow, 3, 'free, not from the stock');
    await page.goto(base + '?devUser=50');
    await mapReady(page);
    await clickCanvas(page, (await g(page, 'm.raceButton')) as { x: number; y: number });
    const raceReady = () => page.waitForFunction(() => (globalThis as any).__sakuraRace?.scene.isActive() && (globalThis as any).__sakuraRace.buttons.length > 0);
    await raceReady();
    await clickCanvas(page, (await g(page, 'globalThis.__sakuraRace.buttons.find((b) => b.label === "Участвовать")')) as { x: number; y: number });
    await page.waitForFunction(() => (globalThis as any).__sakuraRace?.scene.isActive() && (globalThis as any).__sakuraRace.buttons.some((b: any) => b.label === 'Играть'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/29-race.png` });
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('season: pass tiers, collection and frames, festival levels off the map');
  {
    await service.login({ id: 60, firstName: 'Сэцу' });
    await service.claimLogin(60);
    await store.transact(60, (w) => ({
      meta: { ...w.meta, pass: { season: Math.floor((Date.now() - Date.UTC(2025, 11, 31, 21)) / (30 * 86_400_000)), points: 7, free: [], premium: [] }, frames: ['sakura'] },
    }));
    await service.setConfig(JSON.stringify({ festival: 'halloween' }), null);
    const { page, errors } = await open('?devUser=60');
    await mapReady(page);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/30-map-season.png` });
    await clickCanvas(page, (await g(page, 'm.seasonButton')) as { x: number; y: number });
    const seasonReady = () => page.waitForFunction(() => (globalThis as any).__sakuraSeason?.scene.isActive() && (globalThis as any).__sakuraSeason.buttons.length > 0);
    const seasonButton = (label: string) => g(page, `globalThis.__sakuraSeason.buttons.find((b) => b.label === ${JSON.stringify(label)})`) as Promise<{ x: number; y: number }>;
    await seasonReady();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/31-pass.png` });
    await clickCanvas(page, await seasonButton('Забрать'));
    await page.waitForFunction(() => (globalThis as any).__sakuraSeason?.scene.isActive() && (globalThis as any).__sakuraSeason.children.list.some((o: any) => o.text?.startsWith('Получено')));
    assert.deepEqual((await store.getWallet(60)).meta.pass?.free, [1]);
    await seasonReady();
    await clickCanvas(page, await seasonButton('Коллекция'));
    await seasonReady();
    await clickCanvas(page, await seasonButton('Надеть'));
    await page.waitForFunction(() => (globalThis as any).__sakuraSeason?.buttons.some((b: any) => b.label === 'Снять'));
    await page.screenshot({ path: `${OUT}/32-collection.png` });
    assert.equal((await store.getWallet(60)).meta.frame, 'sakura');
    await clickCanvas(page, await seasonButton('Фестиваль'));
    await seasonReady();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/33-festival.png` });
    await clickCanvas(page, await seasonButton('Играть уровень 1'));
    await gameShown(page);
    assert.ok((await g(page, 's.data_.level.id')) as number > 1000);
    assert.deepEqual(errors, []);
    await page.context().close();
    await service.setConfig(JSON.stringify({}), null);
  }

  console.log('level editor: paint ice, add a portal, see the lint warning, run the bot, export JSON');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + 'editor.html');
    await page.selectOption('header select', 'new');
    await page.click('text=Блокеры');
    await page.click('.brushes >> text=лёд ×2');
    await page.click('.board .cell[data-r="3"][data-c="2"]');
    assert.match(await page.inputValue('textarea'), /"\.\.I\.\.\.\.\."/);
    await page.click('text=Порталы');
    await page.click('.board .cell[data-r="1"][data-c="0"]');
    await page.click('.board .cell[data-r="5"][data-c="7"]');
    await page.waitForSelector('.warn >> text=out of nowhere');
    await page.screenshot({ path: `${OUT}/27-editor.png`, fullPage: true });
    await page.click('.board .cell[data-r="1"][data-c="0"]'); // убрать портал
    await page.waitForSelector('.okc');
    await page.fill('section:has(h2:text("Проверка")) input[type=number]', '30');
    await page.click('text=Бот-тест');
    await page.waitForSelector('text=Победы', { timeout: 60_000 });
    assert.deepEqual(errors, []);
    await ctx.close();
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
