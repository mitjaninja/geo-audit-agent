import Phaser from 'phaser';
import { parseLevel } from '@sakura/core';
import type { LevelDef, Match3Game } from '@sakura/core';
import { ApiError, createApi } from './api.ts';
import type { Api, Auth, LivesView } from './api.ts';
import { t } from './i18n.ts';
import { BootScene } from './scenes/BootScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import type { GameOverResult, GameSceneData } from './scenes/GameScene.ts';
import { MapScene } from './scenes/MapScene.ts';
import type { MapData } from './scenes/MapScene.ts';
import { MessageScene } from './scenes/MessageScene.ts';
import type { MessageData } from './scenes/MessageScene.ts';
import { telegram } from './telegram.ts';
import { themeFrom } from './theme.ts';

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
};

type SceneKey = 'game' | 'message' | 'map';
function show(scene: SceneKey, data: GameSceneData | MessageData | MapData): void {
  for (const key of ['game', 'message', 'map']) if (key !== scene && game.scene.isActive(key)) game.scene.stop(key);
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
    lives: progress.lives, onPlay: (id) => void play(id), ...(focus !== undefined ? { focus } : {}),
  });
}

async function play(levelId: number): Promise<void> {
  history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(params), level: String(levelId) })}`);
  if (!api) return startScene(bundled.get(levelId) ?? bundled.get(1)!, randomSeed(), null, null);
  try {
    const attempt = await api.start(levelId);
    progress.lives = livesToClient(attempt.lives);
    startScene(attempt.level, attempt.seed, attempt.attemptId, progress.lives);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_lives') {
      const lives = livesToClient(e.body.lives as LivesView);
      progress.lives = lives;
      message(t.noLivesTitle, t.noLivesText, {
        ...(lives.nextLifeAt ? { countdown: { until: lives.nextLifeAt, label: t.nextLife } } : {}),
        button: { label: t.toMap, onClick: () => showMap(levelId) },
      });
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

function startScene(level: LevelDef, seed: number, attemptId: string | null, lives: LivesView | null): void {
  const onGameOver = async (match: Match3Game, timedOut: boolean): Promise<GameOverResult> => {
    if (!api || !attemptId) {
      const won = match.status === 'won';
      if (won) recordStars(level.id, match.stars);
      return { won, score: match.score, stars: match.stars, lives: null };
    }
    const r = await api.finish(attemptId, match.history, timedOut);
    progress.maxLevel = Math.max(progress.maxLevel, r.maxLevel);
    progress.lives = livesToClient(r.lives);
    if (r.result === 'won') recordStars(level.id, r.stars);
    return { won: r.result === 'won', score: r.score, stars: r.stars, lives: progress.lives };
  };
  const onExit = async (match: Match3Game): Promise<void> => {
    if (api && attemptId) {
      // сервер закроет попытку как брошенную — жизнь сгорит
      const r = await api.finish(attemptId, match.history, false).catch(() => null);
      if (r) progress.lives = livesToClient(r.lives);
    }
    showMap(level.id);
  };
  show('game', {
    level, seed, theme, dpr, lives, onGameOver, onExit,
    onFinish: (action) => {
      if (action === 'map') return showMap(level.id);
      if (action === 'retry') return void play(level.id);
      // «Дальше» после последнего уровня — на карту: новые уровни выходят каждую неделю
      if (level.id < progress.levelCount) void play(level.id + 1);
      else showMap(level.id);
    },
  });
}

async function boot(): Promise<void> {
  if (api) {
    try {
      const me = await api.me();
      clockOffset = me.serverTime - Date.now();
      progress.maxLevel = me.maxLevel;
      progress.levelCount = me.levelCount;
      progress.stars = { ...me.levels };
      progress.lives = livesToClient(me.lives);
    } catch {
      api = null;
    }
  }
  if (!api) {
    // офлайн открыты все уровни из бандла
    progress.maxLevel = bundled.size;
    progress.levelCount = bundled.size;
  }
  // ?level=N — сразу в уровень (разработка, ссылки); иначе — карта
  const wanted = Number(params.get('level') ?? 0);
  if (wanted >= 1) await play(Math.min(wanted, Math.min(progress.maxLevel, progress.levelCount)));
  else showMap();
}

game.events.once('ready', () => {
  game.scene.add('game', GameScene, false);
  game.scene.add('message', MessageScene, false);
  game.scene.add('map', MapScene, false);
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
