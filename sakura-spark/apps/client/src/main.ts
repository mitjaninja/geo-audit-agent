import Phaser from 'phaser';
import { parseLevel } from '@sakura/core';
import type { LevelDef, Match3Game } from '@sakura/core';
import { ApiError, createApi } from './api.ts';
import type { RoomMode } from './api.ts';
import { ChoiceScene } from './scenes/ChoiceScene.ts';
import { RaceScene } from './scenes/RaceScene.ts';
import type { RaceData } from './scenes/RaceScene.ts';
import type { RaceView, SeasonView } from './api.ts';
import { SeasonScene } from './scenes/SeasonScene.ts';
import type { SeasonData, SeasonTab } from './scenes/SeasonScene.ts';
import { cardTitle, rewardText } from './meta.ts';
import type { ChoiceData } from './scenes/ChoiceScene.ts';
import type { Api, Attempt, Auth, ClientEvent, FriendsView, GateView, Item, LivesView, MetaView, ProductId, ShopView, WalletView } from './api.ts';
import { FriendsScene } from './scenes/FriendsScene.ts';
import type { FriendAction, FriendsData } from './scenes/FriendsScene.ts';
import { GateScene } from './scenes/GateScene.ts';
import type { GateData } from './scenes/GateScene.ts';
import { metaBadges } from './meta.ts';
import { DailyScene } from './scenes/DailyScene.ts';
import type { DailyData, MetaClaimRequest } from './scenes/DailyScene.ts';
import { WheelScene } from './scenes/WheelScene.ts';
import type { WheelData } from './scenes/WheelScene.ts';
import { lang, languageFor, setLanguage, t } from './i18n.ts';
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
// язык: ?lang= (разработка, тесты) или язык Telegram игрока; вне Telegram — русский
setLanguage(languageFor(params.get('lang') ?? telegram.languageCode));
document.documentElement.lang = lang;
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
let metaView: MetaView | null = null;
let friendsView: FriendsView | null = null;
let raceView: RaceView | null = null;
let seasonView: SeasonView | null = null;
/** Выпавшая карточка или награда фестиваля — показать по возвращении на карту. */
let pendingNotice: string | null = null;
/** Серия побед на карте: растёт с победой, сгорает при поражении (считает сервер, клиент повторяет для экрана старта). */
let streak = 0;
/** Закрытые ворота района, у которых стоит игрок. */
let gate: GateView | null = null;

const SCENES = ['game', 'message', 'map', 'room', 'start', 'shop', 'daily', 'wheel', 'friends', 'gate', 'choice', 'race', 'season'] as const;
type SceneKey = (typeof SCENES)[number];
function show(scene: SceneKey, data: GameSceneData | MessageData | MapData | RoomData | StartData | ShopData | DailyData | WheelData | FriendsData | GateData | ChoiceData | RaceData | SeasonData): void {
  for (const key of SCENES) if (key !== scene && game.scene.isActive(key)) game.scene.stop(key);
  if (game.scene.isActive(scene)) game.scene.getScene(scene)!.scene.restart(data);
  else game.scene.start(scene, data);
}

function message(title: string, text: string, extra: Partial<MessageData> = {}): void {
  show('message', { theme, dpr, title, text, ...extra });
}

const toClient = (serverMs: number) => serverMs - clockOffset;
const livesToClient = (l: LivesView): LivesView => ({ ...l, nextLifeAt: l.nextLifeAt === null ? null : toClient(l.nextLifeAt) });

function showMap(focus?: number): void {
  if (pendingNotice) {
    const text = pendingNotice;
    pendingNotice = null;
    return message(t.newReward, text, { button: { label: t.toMap, onClick: () => showMap(focus) } });
  }
  history.replaceState(null, '', `?${new URLSearchParams([...params].filter(([k]) => k !== 'level'))}`);
  show('map', {
    theme, dpr, levelCount: progress.levelCount, maxLevel: progress.maxLevel, stars: progress.stars,
    lives: progress.lives, onPlay: (id: number) => showStart(id), ...(focus !== undefined ? { focus } : {}),
    onShare: api ? () => chooseChatMode(() => showMap(focus)) : null,
    crystals: progress.wallet?.crystals ?? null,
    onShop: api && shopView ? () => openShop(() => showMap(focus)) : null,
    onDaily: api && metaView ? () => openDaily(() => showMap(focus)) : null,
    onWheel: api && metaView ? () => openWheel(() => showMap(focus)) : null,
    ...(metaView ? { dailyBadge: metaBadges(metaView).daily, wheelBadge: metaBadges(metaView).wheel } : {}),
    ...(friendsView ? { friends: friendsView.friends, friendsBadge: friendsView.inbox.length > 0 } : {}),
    onFriends: api && friendsView ? () => openFriends(() => showMap(focus)) : null,
    onRace: api && raceView ? () => openRace(() => showMap(focus)) : null,
    raceBadge: raceView?.race?.ended === true,
    onSeason: api && seasonView ? () => openSeason('pass', () => showMap(focus)) : null,
    seasonBadge: seasonView ? seasonView.pass.tiers.some((x) => x.tier <= seasonView!.pass.tier && (!x.freeClaimed || (seasonView!.pass.premium && !x.premiumClaimed))) : false,
    onFestival: api && seasonView?.festival ? () => openSeason('festival', () => showMap(focus)) : null,
    festivalBadge: seasonView?.festival ? seasonView.festival.done < seasonView.festival.levels.length : false,
    frameColor: seasonView?.collection.frame ? seasonView.collection.frames.find((f) => f.id === seasonView!.collection.frame)?.color ?? null : null,
  });
}

function openSeason(tab: SeasonTab, back: () => void): void {
  if (!api || !seasonView) return back();
  const refresh = async () => (seasonView = await api!.season().catch(() => seasonView));
  show('season', {
    theme, dpr, view: seasonView, tab, clockOffset, onClose: back,
    onClaim: async (tier, track) => {
      try {
        const r = await api!.claimPass(tier, track);
        progress.wallet = r.wallet;
        progress.lives = livesToClient(r.lives);
        await refresh();
        return { ...(seasonView ? { view: seasonView } : {}), notice: t.got(rewardText(r.reward)) };
      } catch {
        return { notice: t.failed };
      }
    },
    onBuyPass: telegram.inTelegram ? async () => {
      const r = await purchase('pass', async () => (await refresh())?.pass.premium === true);
      return { ...(seasonView ? { view: seasonView } : {}), ...(r.error ? { notice: r.error } : seasonView?.pass.premium ? { notice: t.season.activated } : {}) };
    } : null,
    onFrame: async (frame) => {
      await api!.setFrame(frame).catch(() => null);
      await refresh();
      return seasonView ? { view: seasonView } : {};
    },
    onPlayFestival: (levelId) => void play(levelId),
  });
}

function openRace(back: () => void): void {
  if (!api || !raceView) return back();
  show('race', {
    theme, dpr, view: raceView, clockOffset, onClose: back, onPlay: () => showMap(),
    onJoin: async () => {
      raceView = await api!.joinRace().catch(() => raceView);
      return raceView;
    },
    onSeen: () => void (async () => {
      await api!.raceSeen().catch(() => {});
      raceView = await api!.race().catch(() => raceView);
      back();
    })(),
  });
}


function openFriends(back: () => void): void {
  if (!api || !friendsView) return back();
  const link = friendsView.inviteLink;
  show('friends', {
    theme, dpr, view: friendsView, onClose: back,
    referral: { crystals: shopView?.social?.referralCrystals ?? 20, level: shopView?.social?.referralLevel ?? 10 },
    onInvite: telegram.inTelegram && link
      ? () => telegram.openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t.share.inviteText)}`)
      : null,
    onAction: async (a: FriendAction) => {
      let notice: string;
      try {
        if (a.kind === 'send') {
          await api!.sendLife(a.id);
          notice = t.friends.lifeSent;
        } else if (a.kind === 'ask') {
          const r = await api!.askLives();
          notice = t.friends.asked(r.asked);
        } else {
          const r = await api!.mail(a.id);
          progress.wallet = r.wallet;
          progress.lives = livesToClient(r.lives);
          notice = t.friends.done;
        }
      } catch (e) {
        notice = e instanceof ApiError ? t.friends.errors[e.code] ?? t.failed : t.noConnection;
      }
      friendsView = await api!.friends().catch(() => friendsView);
      return { ...(friendsView ? { view: friendsView } : {}), notice };
    },
  });
}

/** Ворота района: ключи от друзей, ожидание или кристаллы. */
function showGate(g: GateView): void {
  if (!api) return showMap();
  gate = g;
  show('gate', {
    theme, dpr, gate: g, levelCount: progress.levelCount, crystals: progress.wallet?.crystals ?? 0, clockOffset,
    hasFriends: (friendsView?.friends.length ?? 0) > 0,
    onBack: () => showMap(g.levelId),
    onAsk: async () => {
      try {
        const r = await api!.askKeys();
        return t.gate.asked(r.asked);
      } catch {
        return t.failed;
      }
    },
    onBuy: async () => {
      try {
        const r = await api!.buyGate();
        progress.wallet = r.wallet;
        gate = null;
        showStart(g.levelId);
        return { opened: true };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'no_crystals') {
          await openShopOverlay();
          return { opened: false, notice: t.economy.notEnough };
        }
        return { opened: false, notice: t.failed };
      }
    },
    onOpen: () => void (async () => {
      gate = (await api!.me().catch(() => null))?.gate ?? null;
      if (gate) showGate(gate);
      else showStart(g.levelId);
    })(),
  });
}

/** Награды дня: календарь, задания, сундуки. */
function openDaily(back: () => void): void {
  if (!metaView) return back();
  show('daily', { theme, dpr, meta: metaView, levelCount: progress.levelCount, onClaim: claimMeta, onClose: back });
}

function openWheel(back: () => void): void {
  if (!metaView || !progress.wallet) return back();
  show('wheel', {
    theme, dpr, meta: metaView, crystals: progress.wallet.crystals, onClose: back,
    onSpin: async () => {
      try {
        const r = await api!.spin();
        applyClaim(r);
        return { prize: r.prize, reward: r.reward, meta: r.meta, crystals: r.wallet.crystals };
      } catch (e) {
        return { error: e instanceof ApiError && e.code === 'no_crystals' ? t.economy.notEnough : t.failed };
      }
    },
  });
}

function applyClaim(r: { wallet: WalletView; lives: LivesView; meta: MetaView }): void {
  progress.wallet = r.wallet;
  progress.lives = livesToClient(r.lives);
  metaView = r.meta;
}

async function claimMeta(c: MetaClaimRequest) {
  if (!api) return { error: t.noConnection };
  try {
    const r = c.kind === 'login' ? await api.claimLogin()
      : c.kind === 'task' ? await api.claimTask(c.slot)
        : c.kind === 'chest' ? await api.claimChest(c.episode, c.tier)
          : await api.claimStuck();
    applyClaim(r);
    return { meta: r.meta, reward: r.reward };
  } catch {
    // уже забрано на другом устройстве и т. п. — покажем актуальное
    metaView = await api.meta().catch(() => metaView);
    return { ...(metaView ? { meta: metaView } : {}), error: t.daily.unavailable };
  }
}

/** Мета меняется от игр (задания, звёзды для сундуков): обновить к возврату на карту. */
async function refreshMeta(): Promise<void> {
  if (!api) return;
  [metaView, friendsView, raceView, seasonView] = await Promise.all([
    api.meta().catch(() => metaView), api.friends().catch(() => friendsView), api.race().catch(() => raceView), api.season().catch(() => seasonView),
  ]);
}

/** Экран старта уровня с бустерами (онлайн); офлайн — сразу в игру. */
function showStart(levelId: number, room?: { id: string }): void {
  if (!room && gate && levelId === gate.levelId) return showGate(gate);
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
    loadFriends: api && !room ? () => api!.levelFriends(levelId).then((r) => r.top) : null,
    streak: room ? 0 : streak,
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
/** done — проверка, что покупка дошла (по умолчанию — изменился кошелёк). */
async function purchase(product: ProductId, done?: () => Promise<boolean>): Promise<{ wallet?: WalletView; error?: string }> {
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
    if (done) {
      if (await done()) return {};
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
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
/** PRD: игрок выбирает режим для чата — челлендж, командный фонарь или дуэль. */
function chooseChatMode(back: () => void): void {
  const pick = (mode: RoomMode) => () => {
    back();
    void shareToChat(mode, back);
  };
  show('choice', {
    theme, dpr, title: t.share.title, onBack: back,
    options: [
      { ...t.chatModes.challenge, onClick: pick('challenge') },
      { ...t.chatModes.team, onClick: pick('team') },
      { ...t.chatModes.duel, onClick: pick('duel') },
    ],
  });
}

async function shareToChat(mode: RoomMode, back: () => void): Promise<void> {
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
  let attempt: Attempt;
  try {
    attempt = await withTimeout(api.start(levelId, boosters));
  } catch (e) {
    if (e instanceof StartTimeout) return startFailed(levelId, boosters, t.startTimeout);
    if (e instanceof ApiError && e.code === 'no_lives') {
      noLives(livesToClient(e.body.lives as LivesView), () => showMap(levelId));
    } else if (e instanceof ApiError && e.code === 'episode_locked') {
      showGate(e.body.gate as GateView);
    } else if (e instanceof ApiError && e.code === 'level_locked') {
      await play(Number(e.body.maxLevel ?? 1));
    } else {
      goOffline(levelId);
    }
    return;
  }
  progress.lives = livesToClient(attempt.lives);
  progress.wallet = attempt.wallet;
  try {
    startScene(attempt.level, attempt.seed, attempt.attemptId, progress.lives, { assist: attempt.assist, startBoosters: attempt.startBoosters });
  } catch (e) {
    startFailed(levelId, boosters, e instanceof Error ? e.message : String(e));
  }
}

/** Старт уровня ждёт сервер не дольше этого — дальше честно говорим, что связь подвела. */
const START_TIMEOUT_MS = 15_000;
class StartTimeout extends Error {}
const withTimeout = <T>(p: Promise<T>): Promise<T> => Promise.race([
  p, new Promise<never>((_, reject) => setTimeout(() => reject(new StartTimeout()), START_TIMEOUT_MS)),
]);

/** Уровень не запустился: сообщение с причиной и «Ещё раз» вместо молчащей кнопки. */
function startFailed(levelId: number, boosters: Item[], reason: string): void {
  track({ name: 'client_error', levelId, props: { where: 'start', reason: reason.slice(0, 200) } });
  message(t.startFailed, reason, { button: { label: t.retry, onClick: () => void play(levelId, boosters) } });
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

/** id уровней фестивалей — от 1000 (как на сервере, season.ts). */
const isFestivalLevel = (id: number) => id > 1000;

function startScene(
  level: LevelDef, seed: number, attemptId: string | null, lives: LivesView | null,
  opts: { roomId?: string; eagerHints?: number; assist?: number; startBoosters?: readonly Item[] } = {},
): void {
  const roomId = opts.roomId ?? null;
  const festival = isFestivalLevel(level.id);
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
    if (r.result === 'won' && !roomId && !festival) recordStars(level.id, r.stars);
    if (r.gate) gate = r.gate;
    if (r.drop) pendingNotice = t.season.drop(cardTitle(r.drop.card));
    if (r.festivalReward) pendingNotice = t.season.festivalReward(rewardText(r.festivalReward));
    if (!roomId) streak = r.result === 'won' ? streak + 1 : 0;
    // задания и сундуки зависят от партий — к возврату на карту значки будут свежими
    void refreshMeta();
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
      if (!roomId) streak = 0;
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
      // уровни фестиваля — вне карты: «Дальше» и «На карту» ведут на экран фестиваля
      if (festival && action !== 'retry') return void (async () => {
        seasonView = await api?.season().catch(() => seasonView) ?? seasonView;
        if (pendingNotice) return showMap();
        openSeason('festival', () => showMap());
      })();
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

// ошибки клиента — в аналитику (не больше 5 за сессию): по ним видно, что сломалось на конкретных телефонах
let errorsReported = 0;
const reportError = (where: string, err: unknown): void => {
  if (errorsReported++ >= 5) return;
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  track({ name: 'client_error', props: { where, reason: text.slice(0, 500), ua: navigator.userAgent.slice(0, 160) } });
};
window.addEventListener('error', (e) => reportError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));
// iOS может отобрать WebGL при нехватке памяти — тогда картинка замирает, хотя тапы доходят
game.canvas?.addEventListener('webglcontextlost', () => reportError('webgl', 'context lost'));

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
      gate = me.gate ?? null;
      streak = me.streak ?? 0;
      [shopView, metaView, friendsView, raceView, seasonView] = await Promise.all([
        api.shop().catch(() => null), api.meta().catch(() => null), api.friends().catch(() => null), api.race().catch(() => null),
        api.season().catch(() => null),
      ]);
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
  // награда за вход ещё не забрана — сразу календарь (раз в день); новичка сначала ведём в обучение
  else if (metaView && !metaView.login.claimedToday && progress.maxLevel > 3) openDaily(() => showMap());
  else showMap();
}

game.events.once('ready', () => {
  game.scene.add('game', GameScene, false);
  game.scene.add('message', MessageScene, false);
  game.scene.add('map', MapScene, false);
  game.scene.add('room', RoomScene, false);
  game.scene.add('start', StartScene, false);
  game.scene.add('shop', ShopScene, false);
  game.scene.add('daily', DailyScene, false);
  game.scene.add('wheel', WheelScene, false);
  game.scene.add('friends', FriendsScene, false);
  game.scene.add('gate', GateScene, false);
  game.scene.add('choice', ChoiceScene, false);
  game.scene.add('race', RaceScene, false);
  game.scene.add('season', SeasonScene, false);
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
