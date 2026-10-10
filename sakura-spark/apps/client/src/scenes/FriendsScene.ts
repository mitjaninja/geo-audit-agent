import Phaser from 'phaser';
import type { FriendsView, MailItem } from '../api.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { t } from '../i18n.ts';
import { Ui } from '../ui.ts';

export type FriendAction =
  | { readonly kind: 'send'; readonly id: number }
  | { readonly kind: 'ask' }
  | { readonly kind: 'mail'; readonly id: number };

export interface FriendsData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly view: FriendsView;
  /** Действие на сервере: новый список и строка для игрока. */
  readonly onAction: (a: FriendAction) => Promise<{ view?: FriendsView; notice?: string }>;
  /** Поделиться ссылкой-приглашением; null — вне Telegram или бот не настроен. */
  readonly onInvite: (() => void) | null;
  readonly referral: { readonly crystals: number; readonly level: number };
  readonly onClose: () => void;
  readonly notice?: string;
}

const mailText = (kind: MailItem['kind']): { text: (name: string) => string; button: string } => ({
  life: { text: t.friends.mailLife, button: t.friends.accept },
  ask_life: { text: t.friends.mailAskLife, button: t.friends.give },
  ask_key: { text: t.friends.mailAskKey, button: t.friends.giveKey },
})[kind];

/**
 * Друзья (PRD «Соцфункции»): приглашение по ссылке, почта (подарки и просьбы), подарить или попросить жизнь.
 * Друзья — те, кто играл твой челлендж в чате, дарил тебе жизнь или пришёл по приглашению.
 */
export class FriendsScene extends Phaser.Scene {
  private data_!: FriendsData;
  private ui!: Ui;
  private busy = false;
  private drag: { y: number; scroll: number } | null = null;

  constructor() {
    super('friends');
  }

  get buttons() {
    return this.ui.buttons;
  }

  create(data: FriendsData): void {
    this.data_ = data;
    this.busy = false;
    const { theme, dpr: k, view } = data;
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

    this.ui.text(W / 2, y, t.friends.title, 24, { bold: true });
    y += 30 * k;
    if (data.notice) {
      this.ui.text(W / 2, y, data.notice, 14, { bold: true, color: theme.button, wrap: pw - 48 * k, align: 'center' });
      y += 30 * k;
    }
    y += 10 * k;
    this.ui.button(t.friends.invite, W / 2, y, pw - 48 * k, data.onInvite ? 'primary' : 'disabled', () => data.onInvite?.(), 42);
    y += 34 * k;
    this.ui.text(W / 2, y, data.onInvite
      ? t.friends.referral(data.referral.level, data.referral.crystals)
      : t.friends.inviteOnlyTelegram, 12, { color: theme.hint, wrap: pw - 48 * k, align: 'center' });
    y += 34 * k;
    const canAsk = view.friends.length > 0 && !view.askedToday;
    this.ui.button(view.askedToday ? t.friends.askedToday : t.friends.askAll, W / 2, y, pw - 48 * k,
      canAsk ? 'secondary' : 'disabled', () => void this.act({ kind: 'ask' }), 42);
    y += 40 * k;

    if (view.inbox.length > 0) {
      y += 6 * k;
      this.ui.text(left, y, t.friends.mail(view.inbox.length), 17, { bold: true, originX: 0 });
      y += 32 * k;
      for (const m of view.inbox.slice(0, 5)) {
        const mt = mailText(m.kind);
        this.ui.text(left, y, mt.text(m.from.name || t.friends.friend), 15, { originX: 0, wrap: pw - 170 * k });
        this.ui.button(mt.button, right - 52 * k, y, 104 * k, 'primary', () => void this.act({ kind: 'mail', id: m.id }), 36);
        y += 46 * k;
      }
    }

    y += 6 * k;
    this.ui.text(left, y, view.friends.length > 0 ? t.friends.list(view.giftsLeft) : t.friends.none, 17, { bold: true, originX: 0 });
    y += 30 * k;
    if (view.friends.length === 0) {
      this.ui.text(left, y, t.friends.noneText,
        13, { color: theme.hint, originX: 0, wrap: pw - 48 * k }).setOrigin(0, 0);
      y += 70 * k;
    }
    for (const f of view.friends.slice(0, 8)) {
      this.add.circle(left + 16 * k, y, 16 * k, avatarColor(f.id));
      this.ui.text(left + 16 * k, y, (f.name || '?').slice(0, 1).toUpperCase(), 14, { bold: true, color: '#ffffff' });
      this.ui.text(left + 42 * k, y - 9 * k, f.name || t.friends.friend, 15, { originX: 0 });
      this.ui.text(left + 42 * k, y + 11 * k, t.friends.level(f.maxLevel), 12, { color: theme.hint, originX: 0 });
      const can = !f.sentToday && view.giftsLeft > 0;
      this.ui.button(f.sentToday ? t.friends.sent : t.friends.gift, right - 52 * k, y, 104 * k, can ? 'secondary' : 'disabled',
        () => void this.act({ kind: 'send', id: f.id }), 36);
      y += 48 * k;
    }

    y += 14 * k;
    this.ui.button(t.close, W / 2, y, pw - 48 * k, 'secondary', () => data.onClose());
    y += 40 * k;
    panel.fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top, pw, y - top, 24 * k);
    (globalThis as Record<string, unknown>).__sakuraFriends = this;

    const maxScroll = Math.max(0, y + 12 * k - H);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.drag = { y: p.y, scroll: this.cameras.main.scrollY }));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown || maxScroll === 0) return;
      this.cameras.main.setScroll(0, Phaser.Math.Clamp(this.drag.scroll - (p.y - this.drag.y), 0, maxScroll));
    });
    this.input.on('pointerup', () => (this.drag = null));
  }

  private async act(a: FriendAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await this.data_.onAction(a);
    if (!this.scene.isActive()) return;
    this.scene.restart({ ...this.data_, ...(r.view ? { view: r.view } : {}), notice: r.notice });
  }
}

/** Цвет кружка-аватара друга — стабильный по id. */
export function avatarColor(id: number): number {
  const palette = [0xff8fc0, 0xffa95e, 0x7cc4ff, 0xa58cff, 0x5fcf98, 0xff6f7d, 0xe0a93b];
  return palette[Math.abs(id) % palette.length]!;
}
