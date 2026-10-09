/**
 * Дымовой e2e-тест собранного клиента в настоящем Chromium:
 * загрузка, свайп мышью, тап-тап, доигрывание до экрана результата, уровень с блокерами
 * в тёмной теме, таймер. Падает на любой ошибке страницы. Скриншоты — в SMOKE_OUT (по умолчанию e2e/out).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { preview } from 'vite';

const OUT = resolve(process.env.SMOKE_OUT ?? new URL('./out', import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => existsSync(p));

const server = await preview({ root: new URL('..', import.meta.url).pathname, preview: { port: 4173, strictPort: true } });
const base = 'http://localhost:4173/';
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });

async function open(query: string, colorScheme: 'light' | 'dark' = 'light'): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // без сети: скрипт Telegram подменяем пустым — вне клиента Telegram он и так ничего не делает
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const started = Date.now();
  await page.goto(base + query);
  await page.waitForFunction(() => (globalThis as any).__sakura?.match && (globalThis as any).__sakura.idle);
  console.log(`  ${query}: ready in ${Date.now() - started} ms`);
  return { page, errors };
}

const waitIdle = (page: Page) => page.waitForFunction(() => (globalThis as any).__sakura.idle);
const moves = (page: Page) => page.evaluate(() => (globalThis as any).__sakura.match.movesLeft as number);

/** Центр клетки в CSS-пикселях страницы (canvas рисуется в device pixels с zoom 1/dpr). */
const cssCenter = (page: Page, row: number, col: number) => page.evaluate(([r, c]) => {
  const s = (globalThis as any).__sakura;
  const k = s.data_.dpr;
  const l = s.layout;
  return { x: (l.boardX + (c! + 0.5) * l.cell) / k, y: (l.boardY + (r! + 0.5) * l.cell) / k };
}, [row, col]);

try {
  console.log('level 1: swipe, tap-tap, play to the end');
  {
    const { page, errors } = await open('?level=1&seed=1');
    await page.screenshot({ path: `${OUT}/1-start.png` });
    const before = await moves(page);

    // свайп мышью по первому допустимому ходу
    const swap = await page.evaluate(() => (globalThis as any).__sakura.match.validSwaps()[0]);
    const a = await cssCenter(page, swap.a.row, swap.a.col);
    const b = await cssCenter(page, swap.b.row, swap.b.col);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction((m) => (globalThis as any).__sakura.match.movesLeft === m - 1, before);
    await waitIdle(page);

    // тап-тап по следующему ходу
    const swap2 = await page.evaluate(() => (globalThis as any).__sakura.match.validSwaps()[0]);
    const a2 = await cssCenter(page, swap2.a.row, swap2.a.col);
    const b2 = await cssCenter(page, swap2.b.row, swap2.b.col);
    await page.mouse.click(a2.x, a2.y);
    await page.mouse.click(b2.x, b2.y);
    await page.waitForFunction((m) => (globalThis as any).__sakura.match.movesLeft === m - 2, before);
    await waitIdle(page);
    await page.screenshot({ path: `${OUT}/2-after-moves.png` });

    // неверный свайп за край поля — ход не тратится
    const corner = await cssCenter(page, 0, 0);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x, corner.y - 80, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await moves(page), before - 2);

    const fps = await page.evaluate(() => (globalThis as any).__sakura.game.loop.actualFps as number);
    console.log(`  fps (headless, software GL): ${fps.toFixed(0)}`);

    // доигрываем до конца через тот же путь, что и ввод
    await page.evaluate(async () => {
      const s = (globalThis as any).__sakura;
      while (s.match.status === 'playing') await s.trySwap(s.match.validSwaps()[0]);
    });
    await page.waitForFunction(() => (globalThis as any).__sakura.finished);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/3-result.png` });
    const status = await page.evaluate(() => (globalThis as any).__sakura.match.status);
    console.log(`  finished: ${status}`);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('level 5: holes, blockers, portals, dark theme');
  {
    const { page, errors } = await open('?level=5&seed=3', 'dark');
    await page.screenshot({ path: `${OUT}/4-level5-dark.png` });
    for (let i = 0; i < 6; i++) {
      await page.evaluate(async () => {
        const s = (globalThis as any).__sakura;
        if (s.match.status === 'playing') await s.trySwap(s.match.validSwaps()[0]);
      });
    }
    // картинка совпадает с ядром: число спрайтов = числу фишек на поле
    const consistent = await page.evaluate(() => {
      const s = (globalThis as any).__sakura;
      const pieces = s.match.board.playableCells().filter((p: any) => s.match.board.get(p)).length;
      return pieces === s.sprites.size;
    });
    assert.ok(consistent);
    await page.screenshot({ path: `${OUT}/5-level5-played.png` });
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  console.log('level 6: timer');
  {
    const { page, errors } = await open('?level=6&seed=2');
    const t0 = await page.evaluate(() => (globalThis as any).__sakura.timeLeft as number);
    await page.waitForTimeout(1200);
    const t1 = await page.evaluate(() => (globalThis as any).__sakura.timeLeft as number);
    assert.ok(t1 < t0 - 1 && t1 > t0 - 1.6, `timer follows wall clock: ${t0} → ${t1}`);
    // ускоряем время до конца
    await page.evaluate(() => { (globalThis as any).__sakura.deadline = performance.now() + 50; });
    await page.waitForFunction(() => (globalThis as any).__sakura.finished);
    assert.equal(await page.evaluate(() => (globalThis as any).__sakura.match.status), 'lost');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/6-timeout.png` });
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  console.log(`smoke OK, screenshots in ${OUT}`);
} finally {
  await browser.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
}
