import Phaser from 'phaser';
import type { ProductId, ShopView, WalletView } from '../api.ts';
import { crystals, packList } from '../economy.ts';
import { formatTime, t } from '../i18n.ts';
import { telegram } from '../telegram.ts';
import type { Theme } from '../theme.ts';
import { Ui } from '../ui.ts';

export interface ShopData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly wallet: WalletView;
  readonly shop: ShopView;
  /** Сдвиг часов сервера относительно клиента, мс. */
  readonly clockOffset: number;
  /** Покупка за Stars: новый кошелёк, либо текст ошибки, либо ничего (отмена). */
  readonly onPurchase: (product: ProductId) => Promise<{ wallet?: WalletView; error?: string }>;
  readonly onClose: () => void;
  /** Поверх игры: полупрозрачный фон, игра под ним ждёт. */
  readonly overlay?: boolean;
}

/** Магазин (PRD, «Пакеты кристаллов», «Спецпредложения»): пакеты за Stars, стартовый набор, копилка. */
export class ShopScene extends Phaser.Scene {
  private data_!: ShopData;
  private ui!: Ui;
  private timer: Phaser.GameObjects.Text | null = null;
  private status: Phaser.GameObjects.Text | null = null;
  private busy = false;

  constructor() {
    super('shop');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: ShopData): void {
    this.data_ = data;
    this.busy = false;
    this.timer = null;
    const { theme, dpr: k, wallet, shop } = data;
    this.ui = new Ui(this, theme, k);
    const W = this.scale.width;
    const H = this.scale.height;
    if (data.overlay) this.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0).setInteractive();
    else this.cameras.main.setBackgroundColor(theme.bg);
    const pw = Math.min(W - 24 * k, 400 * k);
    const x = (W - pw) / 2;
    const packs = packList(shop);
    const now = Date.now() + data.clockOffset;
    const starter = wallet.starterUntil !== null && wallet.starterUntil > now;
    const ph = (150 + packs.length * 58 + (starter ? 96 : 0) + 84 + 76) * k;
    let y = Math.max(telegram.insets().top * k + 12 * k, (H - ph) / 2);
    this.ui.panel(x, y, pw, ph);
    y += 36 * k;
    this.ui.text(W / 2, y, t.economy.shop, 24, { bold: true });
    y += 30 * k;
    this.ui.text(W / 2, y, `${t.economy.balance}: ${crystals(wallet.crystals)}`, 15, { color: theme.hint });
    y += 44 * k;

    if (starter) {
      this.ui.text(x + 24 * k, y - 10 * k, t.economy.starterTitle, 17, { bold: true, originX: 0 });
      this.ui.text(x + 24 * k, y + 14 * k,
        t.economy.starterText(shop.starter.crystals, Math.round(shop.starter.infiniteLivesMs / 3600_000)), 13, { color: theme.hint, originX: 0, wrap: pw - 170 * k });
      this.timer = this.ui.text(x + 24 * k, y + 36 * k, '', 12, { color: '#ff5470', originX: 0, bold: true });
      this.ui.button(`${shop.starter.stars} ⭐`, x + pw - 70 * k, y + 6 * k, 100 * k, 'primary', () => void this.buy('starter'), 40);
      y += 96 * k;
    }

    // копилка
    const canBreak = wallet.piggy >= shop.piggy.minToBreak;
    this.ui.text(x + 24 * k, y - 8 * k, t.economy.piggyTitle, 17, { bold: true, originX: 0 });
    this.ui.text(x + 24 * k, y + 16 * k, t.economy.piggyText(wallet.piggy, shop.piggy.max), 13, { color: theme.hint, originX: 0, wrap: pw - 150 * k });
    this.ui.button(`${shop.piggy.stars} ⭐`, x + pw - 70 * k, y + 4 * k, 100 * k, canBreak ? 'secondary' : 'disabled', () => void this.buy('piggy'), 40);
    y += 70 * k;

    for (const p of packs) {
      this.add.image(x + 40 * k, y, 'crystal').setDisplaySize(34 * k, 34 * k);
      this.ui.text(x + 66 * k, y - 9 * k, p.title, 15, { bold: true, originX: 0 });
      this.ui.text(x + 66 * k, y + 12 * k, `${crystals(p.crystals)}${p.bonus ? `  ·  +${p.bonus}%` : ''}`, 13, { color: theme.hint, originX: 0 });
      this.ui.button(`${p.stars} ⭐`, x + pw - 70 * k, y, 100 * k, 'primary', () => void this.buy(p.id), 40);
      y += 58 * k;
    }
    this.status = this.ui.text(W / 2, y + 2 * k, '', 13, { color: '#ff5470', align: 'center', wrap: pw - 40 * k });
    y += 30 * k;
    this.ui.button(t.economy.close, W / 2, y, pw - 48 * k, 'secondary', data.onClose);
    (globalThis as Record<string, unknown>).__sakuraShop = this;
  }

  override update(): void {
    const until = this.data_.wallet.starterUntil;
    if (this.timer && until) this.timer.setText(t.economy.offerEnds(formatTime((until - this.data_.clockOffset - Date.now()) / 1000)));
  }

  private async buy(product: ProductId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status?.setText('');
    const r = await this.data_.onPurchase(product);
    this.busy = false;
    // после покупки — перерисовать витрину с новым кошельком
    if (r.wallet) this.scene.restart({ ...this.data_, wallet: r.wallet });
    else if (r.error) this.status?.setText(r.error);
  }
}
