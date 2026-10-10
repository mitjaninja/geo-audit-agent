import Phaser from 'phaser';
import type { RaceView } from '../api.ts';
import { formatTime, t } from '../i18n.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { Ui } from '../ui.ts';
import { avatarColor } from './FriendsScene.ts';

export interface RaceData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly view: RaceView;
  readonly clockOffset: number;
  readonly onJoin: () => Promise<RaceView | null>;
  /** Итог гонки просмотрен — закрыть и больше не показывать. */
  readonly onSeen: () => void;
  readonly onClose: () => void;
  /** Играть: карта на текущем уровне. */
  readonly onPlay: () => void;
}

const PLACES = ['🥇', '🥈', '🥉'];

/** Гонка фонарей (PRD «События»): до 5 игроков, кто первым пройдёт 10 новых уровней. */
export class RaceScene extends Phaser.Scene {
  private data_!: RaceData;
  private ui!: Ui;
  private timer: Phaser.GameObjects.Text | null = null;
  private busy = false;

  constructor() {
    super('race');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: RaceData): void {
    this.data_ = data;
    this.busy = false;
    this.timer = null;
    const { theme, dpr: k, view } = data;
    this.ui = new Ui(this, theme, k);
    this.cameras.main.setBackgroundColor(theme.bg);
    const W = this.scale.width;
    const pw = Math.min(W - 24 * k, 400 * k);
    const x = (W - pw) / 2;
    const left = x + 24 * k;
    const panel = this.add.graphics().setDepth(-1);
    const top = telegram.insets().top * k + 12 * k;
    let y = top + 38 * k;
    this.add.image(W / 2, y, 'lantern').setDisplaySize(48 * k, 48 * k);
    y += 46 * k;
    this.ui.text(W / 2, y, t.race.title, 24, { bold: true });
    y += 30 * k;
    const prizes = view.prizes.map((c, i) => `${PLACES[i]} ${c} 💎${i === 0 ? t.race.rainbow : ''}`).join(' · ');

    if (!view.race) {
      this.ui.text(W / 2, y, t.race.about(view.size, view.target, view.hours), 14, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
      y += 50 * k;
      this.ui.text(W / 2, y, prizes, 14, { bold: true, wrap: pw - 48 * k, align: 'center' });
      y += 50 * k;
      if (view.canJoin) this.ui.button(t.race.join, W / 2, y, pw - 48 * k, 'primary', () => void this.join());
      else this.ui.text(W / 2, y, t.race.soon, 13, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
      y += 56 * k;
    } else {
      const r = view.race;
      this.timer = this.ui.text(W / 2, y, '', 14, { bold: true });
      y += 22 * k;
      this.ui.text(W / 2, y, r.gathering ? t.race.gathering : prizes, 12, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
      y += 36 * k;
      const trackW = pw - 150 * k;
      for (const m of r.members) {
        if (m.me) this.add.graphics().fillStyle(hexToInt(theme.button), 0.15).fillRoundedRect(x + 12 * k, y - 22 * k, pw - 24 * k, 44 * k, 12 * k);
        this.add.circle(left + 14 * k, y, 14 * k, avatarColor(m.name.length * 7 + m.name.charCodeAt(0)));
        this.ui.text(left + 14 * k, y, (m.name || '?').slice(0, 1).toUpperCase(), 13, { bold: true, color: '#ffffff' });
        this.ui.text(left + 36 * k, y - 9 * k, m.me ? t.race.you(m.name) : m.name, 13, { originX: 0, bold: m.me });
        // дорожка с фонариком
        const tx = left + 36 * k;
        const ty = y + 10 * k;
        this.add.graphics().fillStyle(hexToInt(theme.hint), 0.2).fillRoundedRect(tx, ty - 3 * k, trackW, 6 * k, 3 * k)
          .fillStyle(0xffa94d, 1).fillRoundedRect(tx, ty - 3 * k, Math.max(6 * k, (trackW * m.progress) / r.target), 6 * k, 3 * k);
        this.add.image(tx + (trackW * Math.min(m.progress, r.target)) / r.target, ty, 'lantern').setDisplaySize(16 * k, 16 * k);
        this.ui.text(x + pw - 24 * k, y, m.place ? PLACES[m.place - 1] ?? `${m.place}` : `${m.progress}/${r.target}`, 14, { originX: 1, bold: true });
        y += 50 * k;
      }
      y += 10 * k;
      if (r.ended) this.ui.button(t.race.ok, W / 2, y, pw - 48 * k, 'primary', () => data.onSeen());
      else this.ui.button(t.race.play, W / 2, y, pw - 48 * k, 'primary', () => data.onPlay());
      y += 56 * k;
    }
    this.ui.button(t.close, W / 2, y, pw - 48 * k, 'secondary', () => data.onClose());
    y += 40 * k;
    panel.fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top, pw, y - top, 24 * k);
    (globalThis as Record<string, unknown>).__sakuraRace = this;
  }

  override update(): void {
    const r = this.data_.view.race;
    if (!this.timer || !r) return;
    const left = (r.endsAt - this.data_.clockOffset - Date.now()) / 1000;
    this.timer.setText(r.ended || left <= 0 ? t.race.ended : t.race.endsIn(formatTime(left)));
  }

  private async join(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const v = await this.data_.onJoin();
    if (this.scene.isActive()) this.scene.restart({ ...this.data_, ...(v ? { view: v } : {}) });
  }
}
