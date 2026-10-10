import Phaser from 'phaser';
import type { LevelDef } from '@sakura/core';
import type { Item, LevelFriend, ShopView, WalletView } from '../api.ts';
import { crystals, ITEM_INFO, START_ITEMS } from '../economy.ts';
import { goalLabel, t } from '../i18n.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { Ui } from '../ui.ts';
import { goalIcon } from './hud.ts';

export interface StartData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly title: string;
  readonly level: LevelDef;
  readonly wallet: WalletView;
  readonly shop: ShopView;
  readonly onPlay: (boosters: Item[]) => void;
  readonly onBack: () => void;
  /** Купить бустер за кристаллы; null — не вышло (не хватает кристаллов). */
  readonly onBuy: (item: Item) => Promise<WalletView | null>;
  /** Рейтинг уровня среди друзей (PRD); null — офлайн или комната. */
  readonly loadFriends?: (() => Promise<readonly LevelFriend[]>) | null;
  /** Серия побед (PRD «Серия побед»): бустеры, которые она даёт бесплатно. */
  readonly streak?: number;
}

/** Как на сервере (meta.streakBoosters): 1 — луч и бомба, 2 — и радужный, 3+ — и +3 хода. */
export const streakItems = (streak: number): Item[] => START_ITEMS.slice(0, Math.min(3, Math.max(0, streak)));

/** Экран старта уровня (PRD: бустеры перед уровнем): цели и три бустера на выбор. */
export class StartScene extends Phaser.Scene {
  private data_!: StartData;
  private wallet!: WalletView;
  private readonly selected = new Set<Item>();
  private ui!: Ui;
  /** Переключатели бустеров в пикселях canvas — для e2e. */
  toggles: { item: Item; x: number; y: number }[] = [];
  private toggleViews = new Map<Item, { ring: Phaser.GameObjects.Arc; badge: Phaser.GameObjects.Text }>();
  private free = new Set<Item>();

  constructor() {
    super('start');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: StartData): void {
    this.data_ = data;
    this.wallet = data.wallet;
    this.selected.clear();
    this.toggles = [];
    this.toggleViews = new Map();
    const { theme, dpr: k, level } = data;
    this.ui = new Ui(this, theme, k);
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(theme.bg);
    const pw = Math.min(W - 32 * k, 380 * k);
    const ph = 500 * k;
    const x = (W - pw) / 2;
    const y = Math.max(telegram.insets().top * k + 16 * k, (H - ph) / 2);
    this.ui.panel(x, y, pw, ph);
    this.ui.text(W / 2, y + 40 * k, data.title, 24, { bold: true });
    this.ui.text(W / 2, y + 70 * k, level.timeLimit ? `${t.time}: ${t.seconds(level.timeLimit)}` : `${t.moves}: ${level.moves}`, 15, { color: theme.hint });

    // цели
    const n = level.goals.length;
    level.goals.forEach((goal, i) => {
      const cx = W / 2 + (i - (n - 1) / 2) * 100 * k;
      const icon = this.add.image(cx, y + 120 * k, goalIcon({ goal, current: 0, target: 0, done: false })).setDisplaySize(44 * k, 44 * k);
      if (goal.type === 'score') icon.setTint(0xffc93c);
      const count = goal.type === 'score' ? goal.target : goal.type === 'collect' || goal.type === 'lanterns' ? goal.count : null;
      this.ui.text(cx, y + 160 * k, count !== null ? `${goalLabel(goal)} · ${count}` : goalLabel(goal), 13, { color: theme.hint });
    });

    // бустеры перед уровнем
    const free = streakItems(data.streak ?? 0);
    this.free = new Set(free);
    this.ui.text(W / 2, y + 205 * k, free.length > 0 ? t.economy.streak(data.streak ?? 0, free.length) : t.economy.startBoosters, 15, { bold: true, color: free.length > 0 ? '#ff7a1a' : theme.text });
    START_ITEMS.forEach((item, i) => {
      const cx = W / 2 + (i - 1) * 104 * k;
      const cy = y + 262 * k;
      const ring = this.add.circle(cx, cy, 36 * k, 0xffffff, 0).setStrokeStyle(5 * k, hexToInt(theme.button), 1).setVisible(false);
      this.add.image(cx, cy, `b-${item}`).setDisplaySize(62 * k, 62 * k);
      const badge = this.ui.text(cx + 26 * k, cy + 26 * k, '', 13, { bold: true, color: '#ffffff' });
      badge.setBackgroundColor('#ff6fa8').setPadding(5 * k, 2 * k, 5 * k, 2 * k);
      this.ui.text(cx, cy + 52 * k, ITEM_INFO[item].name, 12, { color: theme.hint, align: 'center', wrap: 96 * k });
      this.add.zone(cx, cy, 80 * k, 80 * k).setInteractive({ useHandCursor: true }).on('pointerup', () => void this.toggle(item));
      this.toggles.push({ item, x: cx, y: cy });
      this.toggleViews.set(item, { ring, badge });
    });
    this.refreshToggles();
    this.ui.text(W / 2, y + 345 * k, `${t.economy.balance}: ${crystals(this.wallet.crystals)}`, 14, { color: theme.hint }).setName('balance');

    const friendsLine = this.ui.text(W / 2, y + 374 * k, '', 13, { color: theme.text, wrap: pw - 40 * k, align: 'center' });
    data.loadFriends?.().then((top) => {
      if (!this.scene.isActive() || top.length === 0) return;
      const fmt = (r: LevelFriend) => `${r.place}. ${r.me ? t.you : r.name} ${r.score.toLocaleString(t.locale)}`;
      const mine = top.find((r) => r.me);
      const shown = top.slice(0, 3);
      if (mine && !shown.includes(mine)) shown.push(mine);
      friendsLine.setText(`🏆 ${shown.map(fmt).join(' · ')}`);
    }).catch(() => {});
    // сразу показываем, что нажатие принято: старт ждёт ответа сервера; повторные тапы не шлют второй старт
    let started = false;
    const [, label] = this.ui.button(t.economy.play, W / 2, y + 422 * k, pw - 48 * k, 'primary', () => {
      if (started) return;
      started = true;
      telegram.haptic('tap');
      (label as Phaser.GameObjects.Text).setText(t.loading);
      data.onPlay([...this.selected]);
    });
    this.ui.button(t.toMap, W / 2, y + 474 * k, pw - 48 * k, 'secondary', data.onBack);
    (globalThis as Record<string, unknown>).__sakuraStart = this;
  }

  private refreshToggles(): void {
    for (const item of START_ITEMS) {
      const v = this.toggleViews.get(item)!;
      const count = this.wallet.items[item];
      const free = this.free.has(item);
      v.ring.setVisible(free || this.selected.has(item)).setStrokeStyle(5 * this.data_.dpr, free ? 0xff7a1a : hexToInt(this.data_.theme.button), 1);
      v.badge.setText(free ? '🔥' : count > 0 ? String(count) : `+ ${crystals(this.data_.shop.itemPrices[item])}`);
    }
    const balance = this.children.getByName('balance') as Phaser.GameObjects.Text | null;
    balance?.setText(`${t.economy.balance}: ${crystals(this.wallet.crystals)}`);
  }

  private async toggle(item: Item): Promise<void> {
    if (this.free.has(item)) return; // уже бесплатно по серии
    if (this.selected.has(item)) {
      this.selected.delete(item);
    } else if (this.wallet.items[item] > 0) {
      this.selected.add(item);
    } else {
      // нет бустера — купить за кристаллы и сразу выбрать
      const w = await this.data_.onBuy(item);
      if (!w) {
        telegram.haptic('error');
        return;
      }
      this.wallet = w;
      this.selected.add(item);
    }
    telegram.haptic('tap');
    this.refreshToggles();
  }
}
