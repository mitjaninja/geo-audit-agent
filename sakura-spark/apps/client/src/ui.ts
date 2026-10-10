import Phaser from 'phaser';
import { hexToInt } from './theme.ts';
import type { Theme } from './theme.ts';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Мелкие строительные блоки экранов: панель, текст, кнопка. Координаты — в пикселях canvas (k = dpr). */
export class Ui {
  /** Кнопки экрана в пикселях canvas — для e2e. */
  readonly buttons: { label: string; x: number; y: number }[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly theme: Theme, private readonly k: number) {}

  panel(x: number, y: number, w: number, h: number, alpha = 1): Phaser.GameObjects.Graphics {
    return this.scene.add.graphics().fillStyle(hexToInt(this.theme.panel), alpha).fillRoundedRect(x, y, w, h, 24 * this.k);
  }

  text(x: number, y: number, s: string, size: number, opts: { color?: string; bold?: boolean; originX?: number; wrap?: number; align?: string } = {}): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, s, {
      fontFamily: FONT, fontSize: `${Math.round(size * this.k)}px`, color: opts.color ?? this.theme.text,
      fontStyle: opts.bold ? 'bold' : 'normal', align: opts.align ?? 'left',
      ...(opts.wrap ? { wordWrap: { width: opts.wrap } } : {}),
    }).setOrigin(opts.originX ?? 0.5, 0.5);
  }

  button(label: string, cx: number, cy: number, w: number, kind: 'primary' | 'secondary' | 'disabled', onClick: () => void, h = 46): Phaser.GameObjects.GameObject[] {
    const k = this.k;
    const bh = h * k;
    const color = kind === 'primary' ? hexToInt(this.theme.button) : hexToInt(this.theme.hint);
    const g = this.scene.add.graphics().fillStyle(color, kind === 'primary' ? 1 : kind === 'disabled' ? 0.12 : 0.25)
      .fillRoundedRect(cx - w / 2, cy - bh / 2, w, bh, bh / 2);
    const t = this.text(cx, cy, label, h >= 46 ? 17 : 15, {
      bold: true, color: kind === 'primary' ? this.theme.buttonText : kind === 'disabled' ? this.theme.hint : this.theme.text,
    });
    const z = this.scene.add.zone(cx, cy, w, bh);
    if (kind !== 'disabled') z.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    this.buttons.push({ label, x: cx, y: cy });
    return [g, t, z];
  }
}
