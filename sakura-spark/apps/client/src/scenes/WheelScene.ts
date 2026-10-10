import Phaser from 'phaser';
import type { MetaView, Reward } from '../api.ts';
import { rewardIcon, rewardText, wheelOdds } from '../meta.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { t } from '../i18n.ts';
import { Ui } from '../ui.ts';

export interface WheelData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly meta: MetaView;
  readonly crystals: number;
  /** Спин на сервере: выпавший приз и новая мета, либо текст ошибки. */
  readonly onSpin: () => Promise<{ prize?: string; reward?: Reward; meta?: MetaView; crystals?: number; error?: string }>;
  readonly onClose: () => void;
  readonly notice?: string;
  /** Угол колеса после спина — чтобы приз остался под указателем. */
  readonly angle?: number;
}

const COLORS = [0xffc2d9, 0xffe0a8, 0xc8e9ff, 0xd9c8ff, 0xc9f0d6, 0xffd0b5, 0xf6c8ff, 0xfff1a8, 0xbfe3e0];

/**
 * Ежедневное колесо (PRD, «Спецпредложения»): один бесплатный спин в день, ещё несколько — за кристаллы.
 * Приз выбирает сервер; сектора одинаковые, настоящие шансы написаны под колесом (PRD: раскрытие вероятностей).
 */
export class WheelScene extends Phaser.Scene {
  private data_!: WheelData;
  private ui!: Ui;
  private wheel!: Phaser.GameObjects.Container;
  private busy = false;

  constructor() {
    super('wheel');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: WheelData): void {
    this.data_ = data;
    this.busy = false;
    const { theme, dpr: k, meta } = data;
    this.ui = new Ui(this, theme, k);
    this.cameras.main.setBackgroundColor(theme.bg);
    const W = this.scale.width;
    const pw = Math.min(W - 24 * k, 400 * k);
    const x = (W - pw) / 2;
    const panel = this.add.graphics().setDepth(-1);
    const top = telegram.insets().top * k + 12 * k;
    let y = top + 36 * k;
    this.ui.text(W / 2, y, t.wheel.title, 24, { bold: true });
    y += 28 * k;
    this.ui.text(W / 2, y, data.notice ?? t.wheel.balance(data.crystals), 14, {
      bold: data.notice !== undefined, color: data.notice ? theme.button : theme.hint, wrap: pw - 48 * k, align: 'center',
    });
    y += 36 * k;

    const R = Math.min(pw * 0.4, 140 * k);
    const cy = y + R + 8 * k;
    const prizes = meta.wheel.prizes;
    const seg = 360 / prizes.length;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    prizes.forEach((p, i) => {
      // сектор i — по центру угла i·seg от верха по часовой стрелке
      const a0 = Phaser.Math.DegToRad(i * seg - seg / 2 - 90);
      const a1 = Phaser.Math.DegToRad(i * seg + seg / 2 - 90);
      g.fillStyle(COLORS[i % COLORS.length]!, 1).slice(0, 0, R, a0, a1, false).fillPath();
      g.lineStyle(2 * k, 0xffffff, 1).slice(0, 0, R, a0, a1, false).strokePath();
      const mid = Phaser.Math.DegToRad(i * seg - 90);
      const ic = rewardIcon(p.reward);
      const ix = Math.cos(mid) * R * 0.68;
      const iy = Math.sin(mid) * R * 0.68;
      const size = R * 0.3;
      const icon = 'texture' in ic
        ? this.add.image(ix, iy, ic.texture).setDisplaySize(size, size)
        : this.add.text(ix, iy, ic.text, { fontSize: `${Math.round(size * 0.7)}px`, color: '#ff5470', fontStyle: 'bold' }).setOrigin(0.5);
      icon.setAngle(i * seg);
      parts.push(icon);
      if (p.reward.crystals) {
        parts.push(this.add.text(Math.cos(mid) * R * 0.4, Math.sin(mid) * R * 0.4, `${p.reward.crystals}`, {
          fontSize: `${Math.round(14 * k)}px`, fontStyle: 'bold', color: '#3a2a4a',
        }).setOrigin(0.5).setAngle(i * seg));
      }
    });
    this.wheel = this.add.container(W / 2, cy, [g, ...parts]).setAngle(data.angle ?? 0);
    this.add.circle(W / 2, cy, R * 0.14, hexToInt(theme.button)).setStrokeStyle(3 * k, 0xffffff);
    // указатель сверху
    this.add.triangle(W / 2, cy - R - 2 * k, -12 * k, -14 * k, 12 * k, -14 * k, 0, 10 * k, hexToInt(theme.button)).setStrokeStyle(2 * k, 0xffffff);
    y = cy + R + 34 * k;

    const w = meta.wheel;
    const label = w.free ? t.wheel.free : w.extraLeft > 0 ? t.wheel.paid(w.price) : t.wheel.none;
    this.ui.button(label, W / 2, y, pw - 48 * k, w.free || w.extraLeft > 0 ? 'primary' : 'disabled', () => void this.spin());
    y += 40 * k;
    if (!w.free && w.extraLeft > 0) {
      this.ui.text(W / 2, y, t.wheel.left(w.extraLeft), 12, { color: theme.hint });
      y += 22 * k;
    }

    // шансы — открыто, в две колонки
    this.ui.text(x + 24 * k, y, t.wheel.odds, 15, { bold: true, originX: 0 });
    y += 20 * k;
    const lines = wheelOdds(meta).split('\n');
    const half = Math.ceil(lines.length / 2);
    const colW = (pw - 48 * k) / 2;
    [lines.slice(0, half), lines.slice(half)].forEach((col, c) => {
      this.add.text(x + 24 * k + c * colW, y, col.join('\n'), {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: `${Math.round(11 * k)}px`, color: theme.hint,
        lineSpacing: 3 * k, wordWrap: { width: colW - 8 * k },
      });
    });
    y += half * 18 * k + 24 * k;
    this.ui.button(t.close, W / 2, y, pw - 48 * k, 'secondary', () => data.onClose());
    y += 40 * k;
    panel.fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top, pw, y - top, 24 * k);
    (globalThis as Record<string, unknown>).__sakuraWheel = this;
  }

  private async spin(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await this.data_.onSpin();
    if (!this.scene.isActive()) return;
    if (!r.meta || r.prize === undefined) {
      this.scene.restart({ ...this.data_, notice: r.error ?? t.failed });
      return;
    }
    const i = Math.max(0, this.data_.meta.wheel.prizes.findIndex((p) => p.id === r.prize));
    const seg = 360 / this.data_.meta.wheel.prizes.length;
    // сектор i окажется под указателем, когда поворот = −i·seg (по модулю 360); плюс 5 оборотов
    const target = 360 * 5 + ((360 - i * seg) % 360) + Phaser.Math.FloatBetween(-seg * 0.3, seg * 0.3);
    this.tweens.addCounter({
      from: this.wheel.angle, to: target, duration: 2600, ease: 'Cubic.easeOut',
      onUpdate: (tw) => (this.wheel.angle = tw.getValue() ?? 0),
      onComplete: () => {
        telegram.haptic('success');
        this.time.delayedCall(400, () => this.scene.restart({
          ...this.data_, meta: r.meta!, crystals: r.crystals ?? this.data_.crystals, notice: t.wheel.won(rewardText(r.reward ?? {})),
          angle: target % 360,
        }));
      },
    });
  }
}
