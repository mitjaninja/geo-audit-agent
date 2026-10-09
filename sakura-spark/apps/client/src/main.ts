import Phaser from 'phaser';
import { parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';
import { BootScene } from './scenes/BootScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import type { GameSceneData } from './scenes/GameScene.ts';
import { telegram } from './telegram.ts';
import { themeFrom } from './theme.ts';

// до этапа 6 уровни встроены в бандл; потом их будет отдавать сервер
const files = import.meta.glob<unknown>('../../../levels/*.json', { eager: true, import: 'default' });
const levels = new Map<number, LevelDef>(Object.values(files).map((json) => {
  const level = parseLevel(json);
  return [level.id, level];
}));

const params = new URLSearchParams(location.search);
let levelId = Number(params.get('level') ?? 1);
if (!levels.has(levelId)) levelId = 1;
const fixedSeed = params.get('seed');
// сид попытки пока выбирает клиент; на этапе 6 его будет выдавать сервер
const nextSeed = () => (fixedSeed !== null ? Number(fixedSeed) : Math.floor(Math.random() * 2 ** 31));

const theme = themeFrom(telegram.themeParams, matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.style.setProperty('--bg', theme.bg);
telegram.init(theme.bg);

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

function sceneData(): GameSceneData {
  return {
    level: levels.get(levelId)!,
    seed: nextSeed(),
    theme,
    dpr,
    onFinish: ({ won, next }) => {
      if (won && next && levels.has(levelId + 1)) levelId++;
      history.replaceState(null, '', `?level=${levelId}${fixedSeed !== null ? `&seed=${fixedSeed}` : ''}`);
      game.scene.getScene('game')!.scene.restart(sceneData());
    },
  };
}

// сцены регистрируем сами: иначе Phaser запустит первую из списка без данных уровня
game.events.once('ready', () => {
  game.scene.add('game', GameScene, false);
  game.scene.add('boot', BootScene, true, sceneData());
});

const onResize = () => {
  const { width, height } = size();
  game.scale.resize(width, height);
  game.scale.setZoom(1 / dpr);
};
window.addEventListener('resize', onResize);
telegram.onChange(onResize);
