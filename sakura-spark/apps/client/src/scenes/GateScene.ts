import Phaser from 'phaser';
import type { GateView } from '../api.ts';
import { formatTime } from '../i18n.ts';
import { episodes } from '../map.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { Ui } from '../ui.ts';

export interface GateData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly gate: GateView;
  readonly levelCount: number;
  readonly crystals: number;
  readonly clockOffset: number;
  readonly hasFriends: boolean;
  readonly onAsk: () => Promise<string>;
  readonly onBuy: () => Promise<{ opened: boolean; notice?: string }>;
  /** Время вышло или ключи собраны — проверить на сервере и играть. */
  readonly onOpen: () => void;
  readonly onBack: () => void;
  readonly notice?: string;
}

/** Ворота нового района (PRD «Помощь в разблокировке»): 3 ключа от друзей, 24 часа или кристаллы. */
export class GateScene extends Phaser.Scene {
  private data_!: GateData;
  private ui!: Ui;
  private timer!: Phaser.GameObjects.Text;
  private busy = false;
  private opened = false;

  constructor() {
    super('gate');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: GateData): void {
    this.data_ = data;
    this.busy = false;
    this.opened = false;
    const { theme, dpr: k, gate } = data;
    this.ui = new Ui(this, theme, k);
    this.cameras.main.setBackgroundColor(theme.bg);
    const W = this.scale.width;
    const H = this.scale.height;
    const pw = Math.min(W - 32 * k, 380 * k);
    const ph = 470 * k;
    const x = (W - pw) / 2;
    const y = Math.max(telegram.insets().top * k + 16 * k, (H - ph) / 2);
    this.ui.panel(x, y, pw, ph);
    const name = episodes(data.levelCount)[gate.episode - 1]?.name ?? `Район ${gate.episode}`;
    this.ui.text(W / 2, y + 40 * k, 'Новый район', 15, { color: theme.hint });
    this.ui.text(W / 2, y + 70 * k, name, 24, { bold: true });
    if (data.notice) this.ui.text(W / 2, y + 102 * k, data.notice, 13, { bold: true, color: theme.button, wrap: pw - 48 * k, align: 'center' });

    // ключи от друзей
    for (let i = 0; i < gate.needed; i++) {
      const cx = W / 2 + (i - (gate.needed - 1) / 2) * 70 * k;
      const got = i < gate.keys;
      this.add.circle(cx, y + 160 * k, 28 * k, got ? 0xffc94d : hexToInt(theme.hint), got ? 1 : 0.15);
      this.ui.text(cx, y + 160 * k, '🔑', 24).setAlpha(got ? 1 : 0.35);
    }
    this.ui.text(W / 2, y + 206 * k, `Ключи от друзей: ${gate.keys} из ${gate.needed}`, 14, { color: theme.hint });
    this.timer = this.ui.text(W / 2, y + 232 * k, '', 14, { bold: true });

    this.ui.button('Попросить ключи', W / 2, y + 286 * k, pw - 48 * k, data.hasFriends ? 'primary' : 'disabled', () => void this.ask());
    if (!data.hasFriends) this.ui.text(W / 2, y + 318 * k, 'Позови друзей — тогда сможешь попросить ключи', 12, { color: theme.hint });
    this.ui.button(`Открыть сейчас · ${gate.price} 💎`, W / 2, y + 358 * k, pw - 48 * k, 'secondary', () => void this.buy());
    this.ui.button('На карту', W / 2, y + 418 * k, pw - 48 * k, 'secondary', data.onBack);
    this.tick();
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    (globalThis as Record<string, unknown>).__sakuraGate = this;
  }

  private tick(): void {
    const left = this.data_.gate.unlockAt - (Date.now() + this.data_.clockOffset);
    if (left <= 0) {
      this.timer.setText('Район открыт!');
      if (!this.opened) {
        this.opened = true;
        this.time.delayedCall(600, () => this.data_.onOpen());
      }
      return;
    }
    this.timer.setText(`Откроется сам через ${formatTime(Math.ceil(left / 1000))}`);
  }

  private async ask(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const notice = await this.data_.onAsk();
    if (this.scene.isActive()) this.scene.restart({ ...this.data_, notice });
  }

  private async buy(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await this.data_.onBuy();
    if (!this.scene.isActive() || r.opened) return;
    this.scene.restart({ ...this.data_, notice: r.notice });
  }
}
