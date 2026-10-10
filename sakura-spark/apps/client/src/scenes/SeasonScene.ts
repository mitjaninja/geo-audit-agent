import Phaser from 'phaser';
import type { Reward, SeasonView } from '../api.ts';
import { formatTime, t } from '../i18n.ts';
import { cardTitle, rewardText } from '../meta.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { Ui } from '../ui.ts';

export type SeasonTab = 'pass' | 'collection' | 'festival';

export interface SeasonData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly view: SeasonView;
  readonly tab: SeasonTab;
  readonly clockOffset: number;
  readonly onClaim: (tier: number, track: 'free' | 'premium') => Promise<{ view?: SeasonView; notice?: string }>;
  /** Купить премиум (подписка Stars); null — вне Telegram. */
  readonly onBuyPass: (() => Promise<{ view?: SeasonView; notice?: string }>) | null;
  readonly onFrame: (frame: string | null) => Promise<{ view?: SeasonView }>;
  readonly onPlayFestival: (levelId: number) => void;
  readonly onClose: () => void;
  readonly notice?: string;
}


/** Сезон (PRD, фаза 4): фестивальный пропуск, коллекция карточек и рамок, сезонный фестиваль. */
export class SeasonScene extends Phaser.Scene {
  private data_!: SeasonData;
  private ui!: Ui;
  private busy = false;
  private drag: { y: number; scroll: number } | null = null;

  constructor() {
    super('season');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: SeasonData): void {
    this.data_ = data;
    this.busy = false;
    this.drag = null;
    const { theme, dpr: k, view } = data;
    this.ui = new Ui(this, theme, k);
    this.cameras.main.setBackgroundColor(theme.bg).setScroll(0, 0);
    const W = this.scale.width;
    const H = this.scale.height;
    const pw = Math.min(W - 24 * k, 400 * k);
    const x = (W - pw) / 2;
    const panel = this.add.graphics().setDepth(-1);
    const top = telegram.insets().top * k + 12 * k;
    let y = top + 30 * k;
    const tabs: SeasonTab[] = view.festival ? ['pass', 'collection', 'festival'] : ['pass', 'collection'];
    const tw = (pw - 32 * k) / tabs.length;
    tabs.forEach((tab, i) => this.ui.button(t.season.tabs[tab], x + 16 * k + tw * (i + 0.5), y, tw - 8 * k, tab === data.tab ? 'primary' : 'secondary',
      () => this.scene.restart({ ...data, tab, notice: undefined }), 36));
    y += 40 * k;
    if (data.notice) {
      this.ui.text(W / 2, y, data.notice, 13, { bold: true, color: theme.button, wrap: pw - 48 * k, align: 'center' });
      y += 28 * k;
    }
    if (data.tab === 'pass') y = this.passTab(x, y, pw);
    else if (data.tab === 'collection') y = this.collectionTab(x, y, pw);
    else y = this.festivalTab(x, y, pw);
    y += 14 * k;
    this.ui.button(t.close, W / 2, y, pw - 48 * k, 'secondary', () => data.onClose());
    y += 40 * k;
    panel.fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top - 14 * k, pw, y - top + 14 * k, 24 * k);
    (globalThis as Record<string, unknown>).__sakuraSeason = this;

    const maxScroll = Math.max(0, y + 12 * k - H);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.drag = { y: p.y, scroll: this.cameras.main.scrollY }));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown || maxScroll === 0) return;
      this.cameras.main.setScroll(0, Phaser.Math.Clamp(this.drag.scroll - (p.y - this.drag.y), 0, maxScroll));
    });
    this.input.on('pointerup', () => (this.drag = null));
  }

  /** Сколько осталось: больше двух суток — «N д M ч», иначе часы:минуты:секунды. */
  private left(ms: number): string {
    const s = Math.max(0, (ms - this.data_.clockOffset - Date.now()) / 1000);
    return s > 2 * 86_400 ? t.season.daysLeft(Math.floor(s / 86_400), Math.floor((s % 86_400) / 3600)) : formatTime(s);
  }

  private passTab(x: number, y0: number, pw: number): number {
    const { theme, dpr: k, view } = this.data_;
    const p = view.pass;
    const W = this.scale.width;
    let y = y0 + 6 * k;
    this.ui.text(W / 2, y, t.season.pass, 20, { bold: true });
    y += 24 * k;
    this.ui.text(W / 2, y, t.season.tierOf(p.tier, p.tiers.length, this.left(p.endsAt)), 12, { color: theme.hint });
    y += 22 * k;
    // полоска до следующей ступени
    const into = p.points - p.tier * p.pointsPerTier;
    const bw = pw - 56 * k;
    this.add.graphics().fillStyle(hexToInt(theme.hint), 0.2).fillRoundedRect(x + 28 * k, y - 6 * k, bw, 12 * k, 6 * k)
      .fillStyle(0x9b7bff, 1).fillRoundedRect(x + 28 * k, y - 6 * k, Math.max(12 * k, (bw * (p.tier >= p.tiers.length ? 1 : into / p.pointsPerTier))), 12 * k, 6 * k);
    y += 20 * k;
    this.ui.text(W / 2, y, t.season.points, 11, { color: theme.hint });
    y += 30 * k;
    if (!p.premium) {
      const buy = this.data_.onBuyPass;
      this.ui.button(t.season.buy(p.price), W / 2, y, pw - 48 * k, buy ? 'primary' : 'disabled', () => void this.act(() => buy!()), 40);
      y += 26 * k;
      this.ui.text(W / 2, y, buy ? t.season.subscription : t.season.subscriptionTelegram, 10, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
      y += 26 * k;
    } else {
      this.ui.text(W / 2, y, t.season.active(this.left(p.passUntil ?? 0)), 13, { bold: true, color: '#9b7bff' });
      y += 28 * k;
    }
    this.ui.text(x + 24 * k, y, t.season.tier, 11, { color: theme.hint, originX: 0 });
    this.ui.text(x + pw * 0.38, y, t.season.free, 11, { color: theme.hint });
    this.ui.text(x + pw * 0.76, y, t.season.premium, 11, { color: '#9b7bff' });
    y += 36 * k;
    // ближайшие ступени: все незабранные открытые и следующие 4
    const rows = p.tiers.filter((t) => (t.tier <= p.tier && (!t.freeClaimed || (p.premium && !t.premiumClaimed))) || (t.tier > p.tier && t.tier <= p.tier + 4));
    for (const t of rows) {
      const open = t.tier <= p.tier;
      this.ui.text(x + 30 * k, y, String(t.tier), 16, { bold: true, color: open ? theme.text : theme.hint });
      this.cell(x + pw * 0.38, y, pw * 0.36, t.free, open && !t.freeClaimed, t.freeClaimed, () => void this.act(() => this.data_.onClaim(t.tier, 'free')));
      this.cell(x + pw * 0.76, y, pw * 0.36, t.premium, open && p.premium && !t.premiumClaimed, t.premiumClaimed, () => void this.act(() => this.data_.onClaim(t.tier, 'premium')));
      y += 56 * k;
    }
    return y;
  }

  private cell(cx: number, cy: number, w: number, r: Reward, canClaim: boolean, claimed: boolean, onClaim: () => void): void {
    const { dpr: k, theme } = this.data_;
    if (canClaim) {
      this.ui.button(t.claim, cx, cy - 6 * k, w - 8 * k, 'primary', onClaim, 30);
      this.ui.text(cx, cy + 17 * k, rewardText(r), 9, { color: theme.hint, wrap: w - 4 * k, align: 'center' });
    } else {
      this.ui.text(cx, cy, claimed ? `✓ ${rewardText(r)}` : rewardText(r), 11, { color: claimed ? '#3bb273' : theme.text, wrap: w - 4 * k, align: 'center' });
    }
  }

  private collectionTab(x: number, y0: number, pw: number): number {
    const { theme, dpr: k, view } = this.data_;
    const c = view.collection;
    const W = this.scale.width;
    let y = y0 + 6 * k;
    for (const set of c.sets) {
      const have = set.cards.filter((x2) => x2.count > 0).length;
      this.ui.text(x + 24 * k, y, `${t.cardSets[set.id] ?? set.title} · ${have}/${set.cards.length}`, 16, { bold: true, originX: 0 });
      y += 26 * k;
      const cw = (pw - 48 * k - 6 * 6 * k) / 7;
      set.cards.forEach((card, i) => {
        const cx = x + 24 * k + i * (cw + 6 * k);
        this.add.graphics().fillStyle(card.count > 0 ? 0xffd6e8 : hexToInt(theme.hint), card.count > 0 ? 1 : 0.15).fillRoundedRect(cx, y, cw, cw * 1.35, 8 * k);
        this.ui.text(cx + cw / 2, y + cw * 0.67, card.count > 0 ? '🎴' : '?', 18, { color: theme.hint });
        if (card.count > 1) this.ui.text(cx + cw - 6 * k, y + 10 * k, `×${card.count}`, 9, { bold: true, color: '#3a2a4a' });
      });
      y += cw * 1.35 + 10 * k;
      this.ui.text(x + 24 * k, y, have === set.cards.length ? t.season.frameDone : t.season.frameGoal, 11, { color: theme.hint, originX: 0 });
      y += 26 * k;
    }
    if (c.extra.length > 0) {
      this.ui.text(x + 24 * k, y, t.season.special(c.extra.map((e) => cardTitle(e.id)).join(', ')), 12, { originX: 0, wrap: pw - 48 * k }).setOrigin(0, 0);
      y += 44 * k;
    }
    this.ui.text(x + 24 * k, y, t.season.frames, 16, { bold: true, originX: 0 });
    y += 30 * k;
    if (c.frames.length === 0) {
      this.ui.text(W / 2, y, t.season.framesHint, 12, { color: theme.hint });
      return y + 20 * k;
    }
    for (const f of c.frames) {
      this.add.circle(x + 40 * k, y, 14 * k, 0xffffff).setStrokeStyle(5 * k, f.color);
      this.ui.text(x + 64 * k, y, t.frames[f.id] ?? f.title, 14, { originX: 0 });
      const on = c.frame === f.id;
      this.ui.button(on ? t.season.takeOff : t.season.wear, x + pw - 74 * k, y, 100 * k, on ? 'secondary' : 'primary', () => void this.act(() => this.data_.onFrame(on ? null : f.id)), 32);
      y += 44 * k;
    }
    return y;
  }

  private festivalTab(x: number, y0: number, pw: number): number {
    const { theme, dpr: k, view } = this.data_;
    const f = view.festival!;
    const W = this.scale.width;
    let y = y0 + 8 * k;
    this.ui.text(W / 2, y, t.festivals[f.id]?.title ?? f.title, 22, { bold: true });
    y += 26 * k;
    this.ui.text(W / 2, y, t.season.endsIn(this.left(f.endsAt)), 12, { color: theme.hint });
    y += 30 * k;
    this.ui.text(W / 2, y, t.festivals[f.id]?.intro ?? f.intro, 13, { wrap: pw - 48 * k, align: 'center' });
    y += 50 * k;
    const n = f.levels.length;
    const step = (pw - 64 * k) / (n - 1);
    f.levels.forEach((_, i) => {
      const cx = x + 32 * k + i * step;
      const done = i < f.done;
      const next = i === f.done;
      this.add.circle(cx, y, 22 * k, done ? 0xffa94d : next ? hexToInt(theme.button) : hexToInt(theme.hint), done || next ? 1 : 0.25)
        .setStrokeStyle(3 * k, 0xffffff);
      this.ui.text(cx, y, done ? '✓' : String(i + 1), 15, { bold: true, color: done || next ? '#ffffff' : theme.hint });
    });
    y += 46 * k;
    this.ui.text(W / 2, y, t.season.festivalRewards(rewardText(f.stepReward), rewardText(f.finalReward)), 11, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
    y += 44 * k;
    if (f.done < n) this.ui.button(t.season.playStep(f.done + 1), W / 2, y, pw - 48 * k, 'primary', () => this.data_.onPlayFestival(f.levels[f.done]!));
    else this.ui.text(W / 2, y, t.season.festivalDone, 16, { bold: true });
    return y + 40 * k;
  }

  private async act(fn: () => Promise<{ view?: SeasonView; notice?: string }>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await fn();
    if (!this.scene.isActive()) return;
    this.scene.restart({ ...this.data_, ...(r.view ? { view: r.view } : {}), notice: r.notice });
  }
}
