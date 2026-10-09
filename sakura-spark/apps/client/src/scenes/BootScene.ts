import Phaser from 'phaser';
import { makeTextures } from '../textures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(data: { onReady: () => void }): void {
    makeTextures(this);
    this.scene.stop();
    data.onReady();
  }
}
