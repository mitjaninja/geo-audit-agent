import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTime, goalLabel } from '../src/i18n.ts';
import { swipeToSwap, tap } from '../src/input.ts';
import { cellAt, cellCenter, computeLayout } from '../src/layout.ts';
import { isDarkColor, themeFrom } from '../src/theme.ts';

const phone = { width: 390, height: 844, insetTop: 0, insetBottom: 0 };

test('layout: board fits the screen, is centred, below the HUD', () => {
  for (const [cols, rows] of [[9, 9], [7, 7], [8, 6], [5, 9]] as const) {
    for (const vp of [phone, { width: 360, height: 640, insetTop: 0, insetBottom: 0 }, { width: 1280, height: 720, insetTop: 0, insetBottom: 0 }]) {
      const l = computeLayout(vp, cols, rows);
      assert.ok(l.boardX >= 0 && l.boardX + l.cell * cols <= vp.width, 'fits horizontally');
      assert.ok(l.boardY >= l.hud.y + l.hud.height && l.boardY + l.cell * rows <= vp.height, 'fits vertically');
      assert.ok(Math.abs(vp.width - (2 * l.boardX + l.cell * cols)) <= 1, 'centred');
      assert.ok(Number.isInteger(l.cell) && l.cell <= 80);
    }
  }
});

test('layout respects Telegram safe-area insets', () => {
  const plain = computeLayout(phone, 9, 9);
  const inset = computeLayout({ ...phone, insetTop: 90, insetBottom: 30 }, 9, 9);
  assert.equal(inset.hud.y, plain.hud.y + 90);
  assert.ok(inset.boardY + inset.cell * 9 <= phone.height - 30);
});

test('cellAt and cellCenter are inverse', () => {
  const l = computeLayout(phone, 9, 9);
  for (const p of [{ row: 0, col: 0 }, { row: 8, col: 8 }, { row: 3, col: 5 }]) {
    const c = cellCenter(l, p);
    assert.deepEqual(cellAt(l, c.x, c.y, 9, 9), p);
  }
  assert.equal(cellAt(l, l.boardX - 1, l.boardY + 5, 9, 9), null);
  assert.equal(cellAt(l, l.boardX + 5, l.boardY + l.cell * 9 + 1, 9, 9), null);
});

test('swipe picks the dominant direction and ignores jitter', () => {
  const from = { row: 4, col: 4 };
  assert.deepEqual(swipeToSwap(from, 30, 5, 40), { a: from, b: { row: 4, col: 5 } });
  assert.deepEqual(swipeToSwap(from, -30, 5, 40), { a: from, b: { row: 4, col: 3 } });
  assert.deepEqual(swipeToSwap(from, 4, -25, 40), { a: from, b: { row: 3, col: 4 } });
  assert.deepEqual(swipeToSwap(from, 3, 30, 40), { a: from, b: { row: 5, col: 4 } });
  assert.equal(swipeToSwap(from, 8, 6, 40), null);
});

test('tap-tap selection', () => {
  const a = { row: 2, col: 2 };
  assert.deepEqual(tap(null, a), { kind: 'select', at: a });
  assert.deepEqual(tap(a, a), { kind: 'deselect' });
  assert.deepEqual(tap(a, { row: 2, col: 3 }), { kind: 'swap', swap: { a, b: { row: 2, col: 3 } } });
  assert.deepEqual(tap(a, { row: 4, col: 4 }), { kind: 'select', at: { row: 4, col: 4 } });
});

test('theme: Telegram colours win, invalid ones fall back, dark detection', () => {
  assert.equal(isDarkColor('#000000'), true);
  assert.equal(isDarkColor('#ffffff'), false);
  const dark = themeFrom({ bg_color: '#17212b', text_color: '#f5f5f5', button_color: 'oops' }, false);
  assert.equal(dark.isDark, true);
  assert.equal(dark.bg, '#17212b');
  assert.equal(dark.text, '#f5f5f5');
  assert.equal(dark.button, '#ff7eb6');
  assert.equal(themeFrom(undefined, true).isDark, true);
  assert.equal(themeFrom(undefined, false).isDark, false);
});

test('texts', () => {
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(9.2), '0:10');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(goalLabel({ type: 'collect', color: 2, count: 5 }), 'луны');
  assert.equal(goalLabel({ type: 'fog' }), 'Туман');
});

test('formatTime with hours', () => {
  assert.equal(formatTime(3725), '1:02:05');
});

test('api client: auth header, JSON body, errors carry code and body', async () => {
  const { ApiError, createApi } = await import('../src/api.ts');
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/api/attempts')) return new Response(JSON.stringify({ error: 'no_lives', lives: { lives: 0 } }), { status: 409 });
    return new Response(JSON.stringify({ maxLevel: 3 }));
  }) as unknown as typeof fetch;
  const api = createApi({ kind: 'tma', initData: 'a=1&hash=x' }, 'https://s', fake);
  assert.equal((await api.me()).maxLevel, 3);
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, 'tma a=1&hash=x');
  await assert.rejects(api.start(2), (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === 'no_lives'
    && (e.body.lives as { lives: number }).lives === 0);
  assert.equal(calls[1]!.init.body, JSON.stringify({ levelId: 2, boosters: [] }));
});

test('economy helpers: next +5 price, packs by price', async () => {
  const { nextExtendPrice, packList, ITEM_INFO, START_ITEMS, GAME_ITEMS } = await import('../src/economy.ts');
  const shop = { extendPrices: [9, 15, 25] };
  assert.deepEqual([0, 1, 2, 3, 9].map((n) => nextExtendPrice(shop, n)), [9, 15, 25, 25, 25]);
  const list = packList({ packs: {
    pack500: { crystals: 500, stars: 1900, bonus: 40, title: 'c' }, pack10: { crystals: 10, stars: 50, bonus: 0, title: 'a' },
    pack50: { crystals: 50, stars: 225, bonus: 10, title: 'b' }, pack100: { crystals: 100, stars: 425, bonus: 20, title: 'd' },
    pack250: { crystals: 250, stars: 1000, bonus: 30, title: 'e' },
  } } as never);
  assert.deepEqual(list.map((p) => p.id), ['pack10', 'pack50', 'pack100', 'pack250', 'pack500']);
  assert.ok(START_ITEMS.every((i) => ITEM_INFO[i].when === 'start'));
  assert.ok(GAME_ITEMS.every((i) => ITEM_INFO[i].when === 'game'));
});
