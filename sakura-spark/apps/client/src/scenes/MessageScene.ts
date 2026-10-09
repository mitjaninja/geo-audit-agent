import Phaser from 'phaser';
import { formatTime } from '../i18n.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';

export interface MessageData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly title: string;
  readonly text: string;
  /** Отсчёт до момента (часы клиента, мс) с подписью; без него — просто текст. */
  readonly countdown?: { readonly until: number; readonly label: (time: string) => string };
  readonly button?: { readonly label: string; readonly onClick: () => void };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Экран-сообщение: загрузка, «жизни закончились» с отсчётом, ошибки. */
export class MessageScene extends Phaser.Scene {
  private countdownText?: Phaser.GameObjects.Text;
  /** Центр кнопки в пикселях canvas — для e2e. */
  buttonCenter: { x: number; y: number } | null = null;
  private data_!: MessageData;

  constructor() {
    super('message');
  }

  create(data: MessageData): void {
    this.data_ = data;
    const { theme, dpr: k } = data;
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(theme.bg);
    const pw = Math.min(W - 40 * k, 340 * k);
    const ph = (data.button ? 280 : 200) * k;
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    this.add.graphics().fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, y, pw, ph, 24 * k);
    this.add.image(W / 2, y + 44 * k, 'lantern').setDisplaySize(64 * k, 64 * k);
    this.add.text(W / 2, y + 96 * k, data.title, {
      fontFamily: FONT, fontSize: `${Math.round(22 * k)}px`, fontStyle: 'bold', color: theme.text,
    }).setOrigin(0.5);
    this.add.text(W / 2, y + 134 * k, data.text, {
      fontFamily: FONT, fontSize: `${Math.round(14 * k)}px`, color: theme.hint, align: 'center',
      wordWrap: { width: pw - 40 * k },
    }).setOrigin(0.5, 0);
    if (data.countdown) {
      this.countdownText = this.add.text(W / 2, y + 186 * k, '', {
        fontFamily: FONT, fontSize: `${Math.round(16 * k)}px`, fontStyle: 'bold', color: theme.text,
      }).setOrigin(0.5);
    }
    if (data.button) {
      const bw = pw - 48 * k;
      const bh = 46 * k;
      const cy = y + ph - 40 * k;
      this.add.graphics().fillStyle(hexToInt(theme.button), 1).fillRoundedRect(W / 2 - bw / 2, cy - bh / 2, bw, bh, bh / 2);
      this.add.text(W / 2, cy, data.button.label, {
        fontFamily: FONT, fontSize: `${Math.round(18 * k)}px`, fontStyle: 'bold', color: theme.buttonText,
      }).setOrigin(0.5);
      const click = data.button.onClick;
      this.buttonCenter = { x: W / 2, y: cy };
      this.add.zone(W / 2, cy, bw, bh).setInteractive({ useHandCursor: true }).on('pointerup', click);
    }
    (globalThis as Record<string, unknown>).__sakuraMessage = this;
  }

  override update(): void {
    const c = this.data_.countdown;
    if (!c || !this.countdownText) return;
    this.countdownText.setText(c.label(formatTime((c.until - Date.now()) / 1000)));
  }
}
