import Phaser from 'phaser';
import { telegram } from '../telegram.ts';
import type { Theme } from '../theme.ts';
import { t } from '../i18n.ts';
import { Ui } from '../ui.ts';

export interface ChoiceData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly title: string;
  readonly options: readonly { readonly label: string; readonly hint: string; readonly onClick: () => void }[];
  readonly onBack: () => void;
}

/** Выбор из нескольких вариантов с пояснениями (режим для чата и т. п.). */
export class ChoiceScene extends Phaser.Scene {
  private ui!: Ui;

  constructor() {
    super('choice');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: ChoiceData): void {
    const { theme, dpr: k } = data;
    this.ui = new Ui(this, theme, k);
    this.cameras.main.setBackgroundColor(theme.bg);
    const W = this.scale.width;
    const H = this.scale.height;
    const pw = Math.min(W - 32 * k, 380 * k);
    const ph = (110 + data.options.length * 84 + 70) * k;
    const x = (W - pw) / 2;
    let y = Math.max(telegram.insets().top * k + 16 * k, (H - ph) / 2);
    this.ui.panel(x, y, pw, ph);
    y += 44 * k;
    this.ui.text(W / 2, y, data.title, 24, { bold: true });
    y += 56 * k;
    for (const o of data.options) {
      this.ui.button(o.label, W / 2, y, pw - 48 * k, 'primary', o.onClick, 44);
      this.ui.text(W / 2, y + 34 * k, o.hint, 12, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
      y += 84 * k;
    }
    this.ui.button(t.back, W / 2, y + 6 * k, pw - 48 * k, 'secondary', data.onBack, 44);
    (globalThis as Record<string, unknown>).__sakuraChoice = this;
  }
}
