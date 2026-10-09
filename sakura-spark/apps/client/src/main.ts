import Phaser from 'phaser';
import { parseLevel } from '@sakura/core';
import type { LevelDef, Match3Game } from '@sakura/core';
import { ApiError, createApi } from './api.ts';
import type { Api, Auth, LivesView } from './api.ts';
import { t } from './i18n.ts';
import { BootScene } from './scenes/BootScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import type { GameOverResult, GameSceneData } from './scenes/GameScene.ts';
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
let maxLevel = 1;
let levelCount = bundled.size;
let currentLevel = Number(params.get('level') ?? 0);

function show(scene: 'game' | 'message', data: GameSceneData | MessageData): void {
  for (const key of ['game', 'message']) if (key !== scene && game.scene.isActive(key)) game.scene.stop(key);
  if (game.scene.isActive(scene)) game.scene.getScene(scene)!.scene.restart(data);
  else game.scene.start(scene, data);
}

function message(title: string, text: string, extra: Partial<MessageData> = {}): void {
  show('message', { theme, dpr, title, text, ...extra });
}

const toClient = (serverMs: number) => serverMs - clockOffset;

async function play(levelId: number): Promise<void> {
  currentLevel = levelId;
  history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(params), level: String(levelId) })}`);
  if (!api) return startScene(bundled.get(levelId) ?? bundled.get(1)!, randomSeed(), null, null);
  try {
    const attempt = await api.start(levelId);
    startScene(attempt.level, attempt.seed, attempt.attemptId, attempt.lives);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_lives') {
      const lives = e.body.lives as LivesView;
      message(t.noLivesTitle, t.noLivesText, {
        ...(lives.nextLifeAt ? { countdown: { until: toClient(lives.nextLifeAt), label: t.nextLife } } : {}),
        button: { label: t.tryAgain, onClick: () => void play(levelId) },
      });
    } else if (e instanceof ApiError && e.code === 'level_locked') {
      await play(Number(e.body.maxLevel ?? 1));
    } else {
      goOffline(levelId);
    }
  }
}

function goOffline(levelId: number): void {
  console.warn(t.offline);
  api = null;
  void play(bundled.has(levelId) ? levelId : 1);
}

const randomSeed = () => (params.get('seed') !== null ? Number(params.get('seed')) : Math.floor(Math.random() * 2 ** 31));

function startScene(level: LevelDef, seed: number, attemptId: string | null, lives: LivesView | null): void {
  const onGameOver = async (match: Match3Game, timedOut: boolean): Promise<GameOverResult> => {
    if (!api || !attemptId) return { won: match.status === 'won', score: match.score, stars: match.stars, lives: null };
    const r = await api.finish(attemptId, match.history, timedOut);
    maxLevel = Math.max(maxLevel, r.maxLevel);
    const nextLifeAt = r.lives.nextLifeAt === null ? null : toClient(r.lives.nextLifeAt);
    return { won: r.result === 'won', score: r.score, stars: r.stars, lives: { ...r.lives, nextLifeAt } };
  };
  show('game', {
    level, seed, theme, dpr, lives, onGameOver,
    onFinish: ({ won, next }) => {
      const count = api ? levelCount : bundled.size;
      void play(won && next && level.id < count ? level.id + 1 : level.id);
    },
  });
}

async function boot(): Promise<void> {
  if (api) {
    try {
      const me = await api.me();
      clockOffset = me.serverTime - Date.now();
      maxLevel = me.maxLevel;
      levelCount = me.levelCount;
    } catch {
      api = null;
    }
  }
  // по умолчанию — самый дальний открытый уровень (карта появится на этапе 7)
  const limit = api ? Math.min(maxLevel, levelCount) : bundled.size;
  const wanted = currentLevel >= 1 ? currentLevel : limit;
  await play(Math.min(Math.max(1, wanted), limit));
}

game.events.once('ready', () => {
  game.scene.add('game', GameScene, false);
  game.scene.add('message', MessageScene, false);
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
