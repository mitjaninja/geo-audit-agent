import Phaser from 'phaser';
import { makeTextures } from '../textures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(data: object): void {
    makeTextures(this);
    this.scene.start('game', data);
  }
}
