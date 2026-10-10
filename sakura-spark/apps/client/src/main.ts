import Phaser from 'phaser';
import { parseLevel } from '@sakura/core';
import type { LevelDef, Match3Game } from '@sakura/core';
import { ApiError, createApi } from './api.ts';
import type { Api, Auth, ClientEvent, Item, LivesView, ProductId, ShopView, WalletView } from './api.ts';
import { t } from './i18n.ts';
import { BootScene } from './scenes/BootScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import type { GameOverResult, GameSceneData } from './scenes/GameScene.ts';
import { MapScene } from './scenes/MapScene.ts';
import type { MapData } from './scenes/MapScene.ts';
import { MessageScene } from './scenes/MessageScene.ts';
import { RoomScene } from './scenes/RoomScene.ts';
import { ShopScene } from './scenes/ShopScene.ts';
import type { ShopData } from './scenes/ShopScene.ts';
import { StartScene } from './scenes/StartScene.ts';
import type { StartData } from './scenes/StartScene.ts';
import type { RoomData } from './scenes/RoomScene.ts';
import type { MessageData } from './scenes/MessageScene.ts';
import { telegram } from './telegram.ts';
import { themeFrom } from './theme.ts';
import { seenIntros } from './tutorial.ts';

/**
 * Онлайн (в Telegram или с ?devUser=<id> против сервера с DEV_AUTH): уровень и сид выдаёт сервер,
 * он же проигрывает ходы и считает итог. Офлайн (?offline=1 или сервер недоступен): уровни из бандла,
 * сид — локальный, прогресс не сохраняется. Офлайн нужен для разработки графики без сервера.
 */
const files = import.meta.glob<unknown>('../../../levels/*.json', { eager: true, import: 'default' });
const bundled = new Map<number, LevelDef>(Object.values(files).map((json) => {
  const level = parseLevel(json);
  return [level.id, level];
}));

const params = new URLSearchParams(location.search);
const intros = seenIntros((() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})());
const theme = themeFrom(telegram.themeParams, matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.style.setProperty('--bg', theme.bg);
telegram.init(theme.bg);

const auth: Auth | null = telegram.initData
  ? { kind: 'tma', initData: telegram.initData }
  : params.get('devUser') ? { kind: 'dev', userId: params.get('devUser')! } : null;
let api: Api | null = auth && params.get('offline') !== '1' ? createApi(auth) : null;

// рисуем в device pixels (не больше 2×), чтобы на телефонах не было мыла, и отображаем с zoom 1/dpr
const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
const size = () => ({ width: Math.round(window.innerWidth * dpr), height: Math.round(window.innerHeight * dpr) });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: theme.bg,
  scale: { mode: Phaser.Scale.NONE, ...size(), zoom: 1 / dpr },
  render: { antialias: true, powerPreference: 'high-performance' },
  input: { activePointers: 1 },
  banner: false,
});

/** Разница часов сервера и клиента: отсчёт до следующей жизни — по серверному времени. */
let clockOffset = 0;
/** Прогресс игрока: обновляется из ответов сервера, без лишних запросов. */
const progress = {
  maxLevel: 1,
  levelCount: bundled.size,
  stars: {} as Record<string, { stars: number }>,
  lives: null as LivesView | null,
  wallet: null as WalletView | null,
};
let shopView: ShopView | null = null;

type SceneKey = 'game' | 'message' | 'map' | 'room' | 'start' | 'shop';
function show(scene: SceneKey, data: GameSceneData | MessageData | MapData | RoomData | StartData | ShopData): void {
  for (const key of ['game', 'message', 'map', 'room', 'start', 'shop']) if (key !== scene && game.scene.isActive(key)) game.scene.stop(key);
  if (game.scene.isActive(scene)) game.scene.getScene(scene)!.scene.restart(data);
  else game.scene.start(scene, data);
}

function message(title: string, text: string, extra: Partial<MessageData> = {}): void {
  show('message', { theme, dpr, title, text, ...extra });
}

const toClient = (serverMs: number) => serverMs - clockOffset;
const livesToClient = (l: LivesView): LivesView => ({ ...l, nextLifeAt: l.nextLifeAt === null ? null : toClient(l.nextLifeAt) });

function showMap(focus?: number): void {
  history.replaceState(null, '', `?${new URLSearchParams([...params].filter(([k]) => k !== 'level'))}`);
  show('map', {
    theme, dpr, levelCount: progress.levelCount, maxLevel: progress.maxLevel, stars: progress.stars,
    lives: progress.lives, onPlay: (id: number) => showStart(id), ...(focus !== undefined ? { focus } : {}),
    onShare: api ? () => void shareToChat('challenge', () => showMap(focus)) : null,
    crystals: progress.wallet?.crystals ?? null,
    onShop: api && shopView ? () => openShop(() => showMap(focus)) : null,
  });
}

/** Экран старта уровня с бустерами (онлайн); офлайн — сразу в игру. */
function showStart(levelId: number, room?: { id: string }): void {
  const file = bundled.get(levelId);
  // в комнате уровень как в файле — у всех чата одинаковый; на карте — со сдвигом remote config
  const level = file && !room ? { ...file, ...levelOverrides[levelId] } : file;
  if (!api || !progress.wallet || !shopView || !level) {
    if (room) return void playRoom(room.id);
    return void play(levelId);
  }
  show('start', {
    theme, dpr, level, wallet: progress.wallet, shop: shopView,
    title: room ? t.room.title : t.level(levelId),
    onPlay: (boosters: Item[]) => void (room ? playRoom(room.id, boosters) : play(levelId, boosters)),
    onBack: () => (room ? void showRoom(room.id) : showMap(levelId)),
    onBuy: buyItem,
  });
}

async function buyItem(item: Item): Promise<WalletView | null> {
  if (!api) return null;
  try {
    const r = await api.buy(item);
    progress.wallet = r.wallet;
    return r.wallet;
  } catch {
    return null;
  }
}

/** Покупка за Stars: счёт → окно оплаты Telegram → ждём, пока сервер зачислит (вебхук может прийти чуть позже). */
async function purchase(product: ProductId): Promise<{ wallet?: WalletView; error?: string }> {
  if (!api) return {};
  if (!telegram.inTelegram) return { error: t.economy.paymentsOnlyTelegram };
  let link: string;
  try {
    link = (await api.purchase(product)).link;
  } catch {
    return { error: t.economy.paymentFailed };
  }
  const before = JSON.stringify(progress.wallet);
  const status = await telegram.openInvoice(link);
  if (status === 'unsupported') return { error: t.economy.paymentsOnlyTelegram };
  if (status !== 'paid') return status === 'failed' ? { error: t.economy.paymentFailed } : {};
  for (let i = 0; i < 10; i++) {
    const me = await api.me().catch(() => null);
    if (me && JSON.stringify(me.wallet) !== before) {
      progress.wallet = me.wallet;
      progress.lives = livesToClient(me.lives);
      return { wallet: me.wallet };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { error: t.economy.paymentPending };
}

function shopData(onClose: () => void, overlay = false): ShopData {
  void api?.events([{ name: 'shop_opened' }]);
  return { theme, dpr, wallet: progress.wallet!, shop: shopView!, clockOffset, onPurchase: purchase, onClose, overlay };
}

function openShop(back: () => void): void {
  if (!progress.wallet || !shopView) return;
  show('shop', shopData(back));
}

/** Магазин поверх игры или сообщения: сцена под ним ждёт; результат — новый кошелёк, если что-то куплено. */
function openShopOverlay(): Promise<WalletView | null> {
  if (!progress.wallet || !shopView) return Promise.resolve(null);
  const before = JSON.stringify(progress.wallet);
  return new Promise((resolve) => {
    game.scene.run('shop', shopData(() => {
      game.scene.stop('shop');
      resolve(JSON.stringify(progress.wallet) !== before ? progress.wallet : null);
    }, true));
    game.scene.bringToTop('shop');
  });
}

/**
 * «Позвать в чат» / «Попросить жизнь»: сервер создаёт комнату и готовит карточку, Telegram показывает
 * выбор чата (shareMessage, Bot API 8.0). Без него — ссылка через t.me/share; вне Telegram — подсказка.
 */
async function shareToChat(mode: 'challenge' | 'help', back: () => void): Promise<void> {
  if (!api) return;
  if (!telegram.inTelegram) {
    message(t.share.title, t.share.onlyTelegram, { button: { label: t.toMap, onClick: back } });
    return;
  }
  try {
    const room = await api.createRoom(mode);
    if (room.preparedMessageId && telegram.canShareMessage) await telegram.shareMessage(room.preparedMessageId);
    else if (room.link) telegram.openLink(`https://t.me/share/url?url=${encodeURIComponent(room.link)}`);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'room_limit') message(t.share.title, t.share.limit, { button: { label: t.toMap, onClick: back } });
  }
}

/** Комната челленджа из ссылки в чате. */
async function showRoom(roomId: string): Promise<void> {
  if (!api) return showMap();
  try {
    const view = await api.room(roomId);
    show('room', { theme, dpr, view, clockOffset, onPlay: () => showStart(view.levelId, { id: roomId }), onMap: () => showMap() });
  } catch {
    message(t.room.title, t.room.notFound, { button: { label: t.toMap, onClick: () => showMap() } });
  }
}

async function playRoom(roomId: string, boosters: Item[] = []): Promise<void> {
  if (!api) return;
  try {
    const attempt = await api.startRoom(roomId, boosters);
    progress.lives = livesToClient(attempt.lives);
    progress.wallet = attempt.wallet;
    // новичок из чата (PRD): подсказки на первых трёх ходах
    const newcomer = progress.maxLevel <= 1 && Object.keys(progress.stars).length === 0;
    startScene(attempt.level, attempt.seed, attempt.attemptId, progress.lives, {
      roomId, eagerHints: newcomer ? 3 : 0, assist: attempt.assist, startBoosters: attempt.startBoosters,
    });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_lives') noLives(livesToClient(e.body.lives as LivesView), () => void showRoom(roomId));
    else await showRoom(roomId);
  }
}

function noLives(lives: LivesView, back: () => void): void {
  progress.lives = lives;
  const refill = async () => {
    if (!api) return;
    try {
      const r = await api.refillLives();
      progress.lives = livesToClient(r.lives);
      progress.wallet = r.wallet;
      back();
    } catch (e) {
      // не хватает кристаллов — магазин поверх, потом ещё попытка
      if (e instanceof ApiError && e.code === 'no_crystals' && (await openShopOverlay())) await refill();
    }
  };
  message(t.noLivesTitle, t.noLivesText, {
    ...(lives.nextLifeAt ? { countdown: { until: lives.nextLifeAt, label: t.nextLife } } : {}),
    ...(api && shopView
      ? {
        button: { label: t.economy.refill(shopView.refillLives), onClick: () => void refill() },
        secondary: { label: t.share.askLife, onClick: () => void shareToChat('help', back) },
        tertiary: { label: t.toMap, onClick: () => showMap() },
      }
      : { button: { label: t.toMap, onClick: () => showMap() } }),
  });
}

async function play(levelId: number, boosters: Item[] = []): Promise<void> {
  history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(params), level: String(levelId) })}`);
  if (!api) return startScene(bundled.get(levelId) ?? bundled.get(1)!, randomSeed(), null, null);
  try {
    const attempt = await api.start(levelId, boosters);
    progress.lives = livesToClient(attempt.lives);
    progress.wallet = attempt.wallet;
    startScene(attempt.level, attempt.seed, attempt.attemptId, progress.lives, { assist: attempt.assist, startBoosters: attempt.startBoosters });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_lives') {
      noLives(livesToClient(e.body.lives as LivesView), () => showMap(levelId));
    } else if (e instanceof ApiError && e.code === 'level_locked') {
      await play(Number(e.body.maxLevel ?? 1));
    } else {
      goOffline(levelId);
    }
  }
}

function goOffline(levelId: number): void {
  progress.maxLevel = bundled.size;
  progress.levelCount = bundled.size;
  console.warn(t.offline);
  api = null;
  void play(bundled.has(levelId) ? levelId : 1);
}

const randomSeed = () => (params.get('seed') !== null ? Number(params.get('seed')) : Math.floor(Math.random() * 2 ** 31));

function recordStars(levelId: number, stars: number): void {
  const prev = progress.stars[levelId]?.stars ?? 0;
  progress.stars[levelId] = { stars: Math.max(prev, stars) };
}

function startScene(
  level: LevelDef, seed: number, attemptId: string | null, lives: LivesView | null,
  opts: { roomId?: string; eagerHints?: number; assist?: number; startBoosters?: readonly Item[] } = {},
): void {
  const roomId = opts.roomId ?? null;
  const onGameOver = async (match: Match3Game, timedOut: boolean): Promise<GameOverResult> => {
    if (!api || !attemptId) {
      const won = match.status === 'won';
      if (won) recordStars(level.id, match.stars);
      return { won, score: match.score, stars: match.stars, lives: null };
    }
    const r = await api.finish(attemptId, match.history, timedOut);
    progress.maxLevel = Math.max(progress.maxLevel, r.maxLevel);
    progress.lives = livesToClient(r.lives);
    progress.wallet = r.wallet;
    // в комнате звёзды не идут в прогресс карты
    if (r.result === 'won' && !roomId) recordStars(level.id, r.stars);
    return {
      won: r.result === 'won', score: r.score, stars: r.stars, lives: progress.lives,
      ...(r.room ? { room: { place: r.room.place, players: r.room.players } } : {}),
    };
  };
  const onExit = async (match: Match3Game): Promise<void> => {
    if (api && attemptId) {
      // сервер закроет попытку как брошенную — жизнь сгорит
      const r = await api.finish(attemptId, match.history, false).catch(() => null);
      if (r) progress.lives = livesToClient(r.lives);
    }
    if (roomId) await showRoom(roomId);
    else showMap(level.id);
  };
  show('game', {
    level, seed, theme, dpr, lives, onGameOver, onExit, intros, track,
    room: roomId ? { id: roomId } : null, eagerHints: opts.eagerHints ?? 0,
    assist: opts.assist ?? 0, startBoosters: opts.startBoosters ?? [],
    wallet: api && attemptId ? progress.wallet : null, shop: api && attemptId ? shopView : null,
    onBuyItem: buyItem,
    onOpenShop: openShopOverlay,
    onExtend: async (match) => {
      if (!api || !attemptId) return { status: 'error' };
      try {
        const r = await api.extend(attemptId, match.history);
        progress.wallet = r.wallet;
        return { status: 'ok', wallet: r.wallet };
      } catch (e) {
        return { status: e instanceof ApiError && e.code === 'no_crystals' ? 'no_crystals' : 'error' };
      }
    },
    onFinish: (action) => {
      if (action === 'map') return showMap(roomId ? undefined : level.id);
      if (roomId) return void (action === 'retry' ? playRoom(roomId) : showRoom(roomId));
      if (action === 'retry') return void play(level.id);
      // «Дальше» после последнего уровня — на карту: новые уровни выходят каждую неделю
      if (level.id < progress.levelCount) void play(level.id + 1);
      else showMap(level.id);
    },
  });
}

const track = (event: ClientEvent): void => void api?.events([event]);

/** Сессии для аналитики: начало — запуск или возврат после 30+ минут, конец — когда Mini App свернули. */
const SESSION_GAP_MS = 30 * 60_000;
let sessionStart = Date.now();
let hiddenAt: number | null = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    track({ name: 'session_end', props: { durationMs: hiddenAt - sessionStart } });
  } else if (hiddenAt !== null && Date.now() - hiddenAt > SESSION_GAP_MS) {
    sessionStart = Date.now();
    track({ name: 'session_start', props: { resumed: true } });
  }
});

/** Сдвиги ходов и времени из remote config — для экрана старта; партию сервер присылает уже сдвинутой. */
let levelOverrides: Record<string, { moves?: number; timeLimit?: number }> = {};

async function boot(): Promise<void> {
  if (api) {
    try {
      const me = await api.me();
      clockOffset = me.serverTime - Date.now();
      progress.maxLevel = me.maxLevel;
      progress.levelCount = me.levelCount;
      progress.stars = { ...me.levels };
      progress.lives = livesToClient(me.lives);
      progress.wallet = me.wallet;
      levelOverrides = me.levelOverrides ?? {};
      shopView = await api.shop().catch(() => null);
      track({ name: 'session_start', props: { platform: telegram.inTelegram ? 'telegram' : 'web' } });
    } catch {
      api = null;
    }
  }
  if (!api) {
    // офлайн открыты все уровни из бандла
    progress.maxLevel = bundled.size;
    progress.levelCount = bundled.size;
  }
  // комната чат-режима: из startapp (прямая ссылка) или ?room= (кнопка бота в личке)
  const start = telegram.startParam;
  const roomId = start?.startsWith('r') ? start : params.get('room');
  if (api && roomId) return showRoom(roomId);
  // ?level=N — сразу в уровень (разработка, ссылки); иначе — карта
  const wanted = Number(params.get('level') ?? 0);
  if (wanted >= 1) await play(Math.min(wanted, Math.min(progress.maxLevel, progress.levelCount)));
  else showMap();
}

game.events.once('ready', () => {
  game.scene.add('game', GameScene, false);
  game.scene.add('message', MessageScene, false);
  game.scene.add('map', MapScene, false);
  game.scene.add('room', RoomScene, false);
  game.scene.add('start', StartScene, false);
  game.scene.add('shop', ShopScene, false);
  // Boot рисует текстуры и сразу передаёт управление
  game.scene.add('boot', BootScene, true, { onReady: () => void boot() });
});

const onResize = () => {
  const { width, height } = size();
  game.scale.resize(width, height);
  game.scale.setZoom(1 / dpr);
};
window.addEventListener('resize', onResize);
telegram.onChange(onResize);
