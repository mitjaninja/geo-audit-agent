import Phaser from 'phaser';
import { artFiles } from '../art.ts';
import { loadSvgTextures, makeTextures } from '../textures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    // арт необязателен: не загрузился файл — сцены рисуют без него (проверяют textures.exists)
    for (const f of artFiles()) this.load.image(f.key, f.url);
  }

  async create(data: { onReady: () => void }): Promise<void> {
    makeTextures(this);
    await loadSvgTextures(this);
    this.scene.stop();
    data.onReady();
  }
}
