import Phaser from 'phaser';
import type { MetaView, Reward } from '../api.ts';
import { episodes } from '../map.ts';
import { rewardIcon, rewardText, taskText } from '../meta.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { t } from '../i18n.ts';
import { Ui } from '../ui.ts';

export type MetaClaimRequest =
  | { readonly kind: 'login' }
  | { readonly kind: 'task'; readonly slot: number }
  | { readonly kind: 'chest'; readonly episode: number; readonly tier: number }
  | { readonly kind: 'stuck' };

export interface DailyData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly meta: MetaView;
  readonly levelCount: number;
  /** Забрать награду: новая мета и полученное, либо текст ошибки. */
  readonly onClaim: (c: MetaClaimRequest) => Promise<{ meta?: MetaView; reward?: Reward; error?: string }>;
  readonly onClose: () => void;
  /** Строка над календарём: что только что получено. */
  readonly notice?: string;
}

/**
 * Награды дня (PRD, «Мета-прогрессия», «Ежедневный вход»): 7-дневный календарь, 3 задания,
 * сундуки районов за 30 и 45 звёзд, подарок застрявшему на уровне.
 */
export class DailyScene extends Phaser.Scene {
  private data_!: DailyData;
  private ui!: Ui;
  private busy = false;
  private drag: { y: number; scroll: number } | null = null;

  constructor() {
    super('daily');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: DailyData): void {
    this.data_ = data;
    this.busy = false;
    const { theme, dpr: k, meta } = data;
    this.ui = new Ui(this, theme, k);
    this.cameras.main.setBackgroundColor(theme.bg).setScroll(0, 0);
    const W = this.scale.width;
    const H = this.scale.height;
    const pw = Math.min(W - 24 * k, 400 * k);
    const x = (W - pw) / 2;
    const left = x + 24 * k;
    const right = x + pw - 24 * k;
    const panel = this.add.graphics().setDepth(-1);
    const top = telegram.insets().top * k + 12 * k;
    let y = top + 36 * k;

    this.ui.text(W / 2, y, t.daily.title, 24, { bold: true });
    y += 30 * k;
    if (data.notice) {
      this.ui.text(W / 2, y, data.notice, 14, { bold: true, color: theme.button, wrap: pw - 48 * k, align: 'center' });
      y += 30 * k;
    }

    // календарь входа
    y += 6 * k;
    this.ui.text(left, y, t.daily.calendar, 17, { bold: true, originX: 0 });
    y += 22 * k;
    const gap = 6 * k;
    const cw = (pw - 48 * k - gap * 6) / 7;
    const ch = cw * 1.3;
    meta.login.rewards.forEach((r, i) => {
      const cx = left + i * (cw + gap);
      const claimed = i < meta.login.position;
      const today = i === meta.login.position && !meta.login.claimedToday;
      const g = this.add.graphics();
      g.fillStyle(today ? hexToInt(theme.button) : hexToInt(theme.hint), today ? 0.25 : claimed ? 0.06 : 0.12).fillRoundedRect(cx, y, cw, ch, 10 * k);
      if (today) g.lineStyle(2 * k, hexToInt(theme.button), 1).strokeRoundedRect(cx, y, cw, ch, 10 * k);
      if (i === 6) g.lineStyle(2 * k, 0xffc94d, 1).strokeRoundedRect(cx + k, y + k, cw - 2 * k, ch - 2 * k, 9 * k);
      this.ui.text(cx + cw / 2, y + 12 * k, `${i + 1}`, 11, { color: theme.hint, bold: true });
      this.icon(r, cx + cw / 2, y + ch * 0.6, cw * 0.62).setAlpha(claimed ? 0.35 : 1);
      if (claimed) this.ui.text(cx + cw / 2, y + ch * 0.6, '✓', 22, { bold: true, color: '#3bb273' });
    });
    y += ch + 30 * k;
    const todayReward = meta.login.rewards[meta.login.position];
    if (!meta.login.claimedToday && todayReward) {
      this.ui.button(t.daily.claimReward, W / 2, y, pw - 48 * k, 'primary', () => void this.claim({ kind: 'login' }), 42);
      y += 22 * k;
      this.ui.text(W / 2, y + 8 * k, rewardText(todayReward), 12, { color: theme.hint });
      y += 30 * k;
    } else {
      this.ui.text(W / 2, y - 6 * k, t.daily.tomorrow, 14, { color: theme.hint });
      y += 22 * k;
    }

    // помощь застрявшему
    if (meta.stuck) {
      y += 10 * k;
      this.ui.text(left, y, t.daily.stuck(meta.stuck.levelId), 16, { bold: true, originX: 0 });
      this.ui.text(left, y + 20 * k, t.daily.gift(rewardText(meta.stuck.reward)), 12, { color: theme.hint, originX: 0, wrap: pw - 170 * k });
      this.ui.button(t.claim, right - 48 * k, y + 8 * k, 96 * k, 'primary', () => void this.claim({ kind: 'stuck' }), 36);
      y += 52 * k;
    }

    // задания
    y += 10 * k;
    this.ui.text(left, y, t.daily.tasks, 17, { bold: true, originX: 0 });
    y += 30 * k;
    meta.tasks.forEach((task, slot) => {
      const done = task.progress >= task.target;
      this.ui.text(left, y, taskText(task), 15, { originX: 0, wrap: pw - 170 * k });
      this.ui.text(left, y + 19 * k, rewardText(task.reward), 12, { color: theme.hint, originX: 0, wrap: pw - 170 * k });
      // очки — в процентах: «12 340/25 000» не влезает в кнопку
      const progressLabel = task.target >= 1000 ? `${Math.floor((task.progress / task.target) * 100)}%` : `${task.progress}/${task.target}`;
      const label = task.claimed ? '✓' : done ? t.claim : progressLabel;
      this.ui.button(label, right - 48 * k, y + 8 * k, 96 * k, done && !task.claimed ? 'primary' : 'disabled',
        () => void this.claim({ kind: 'task', slot }), 36);
      y += 52 * k;
    });

    // сундуки районов: последний открытый район и те, где есть что забрать
    const names = episodes(data.levelCount);
    const chests = meta.chests.filter((c, i) => i === meta.chests.length - 1 || c.tiers.some((t) => t.available && !t.claimed)).slice(-2);
    if (chests.length > 0) {
      y += 4 * k;
      this.ui.text(left, y, t.daily.chests, 17, { bold: true, originX: 0 });
      y += 30 * k;
      for (const c of chests) {
        this.ui.text(left, y, names[c.episode - 1]?.name ?? t.district(c.episode), 15, { originX: 0 });
        this.ui.text(left, y + 19 * k, t.daily.chestStars(c.stars), 12, { color: theme.hint, originX: 0 });
        c.tiers.forEach((tier, i) => {
          const kind = tier.available && !tier.claimed ? 'primary' : 'disabled';
          this.ui.button(tier.claimed ? '✓' : `${tier.tier} ★`, right - 34 * k - (1 - i) * 76 * k, y + 8 * k, 68 * k, kind,
            () => void this.claim({ kind: 'chest', episode: c.episode, tier: tier.tier }), 36);
        });
        y += 52 * k;
      }
    }

    y += 16 * k;
    this.ui.button(t.close, W / 2, y, pw - 48 * k, 'secondary', () => data.onClose());
    y += 40 * k;
    panel.fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top, pw, y - top, 24 * k);
    (globalThis as Record<string, unknown>).__sakuraDaily = this;

    // длинный список на маленьком экране — прокрутка пальцем
    const maxScroll = Math.max(0, y + 12 * k - H);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.drag = { y: p.y, scroll: this.cameras.main.scrollY }));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown || maxScroll === 0) return;
      this.cameras.main.setScroll(0, Phaser.Math.Clamp(this.drag.scroll - (p.y - this.drag.y), 0, maxScroll));
    });
    this.input.on('pointerup', () => (this.drag = null));
  }

  private icon(r: Reward, cx: number, cy: number, size: number): Phaser.GameObjects.Image | Phaser.GameObjects.Text {
    const ic = rewardIcon(r);
    if ('texture' in ic) return this.add.image(cx, cy, ic.texture).setDisplaySize(size, size);
    return this.ui.text(cx, cy, ic.text, Math.round((size / this.data_.dpr) * 0.7), { color: ic.text === '♥' ? '#ff5470' : this.data_.theme.text, bold: true });
  }

  private async claim(c: MetaClaimRequest): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await this.data_.onClaim(c);
    if (!this.scene.isActive()) return;
    if (r.meta) this.scene.restart({ ...this.data_, meta: r.meta, notice: r.reward ? t.got(rewardText(r.reward)) : undefined });
    else this.scene.restart({ ...this.data_, notice: r.error ?? t.failed });
  }
}
