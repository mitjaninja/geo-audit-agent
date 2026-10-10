import Phaser from 'phaser';
import type { RoomView } from '../api.ts';
import { rewardText } from '../meta.ts';
import { formatTime, t } from '../i18n.ts';
import { telegram } from '../telegram.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';

export interface RoomData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly view: RoomView;
  /** Сдвиг часов сервера относительно клиента, мс. */
  readonly clockOffset: number;
  readonly onPlay: () => void;
  readonly onMap: () => void;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MEDALS = ['🥇', '🥈', '🥉', '4', '5'];

/**
 * Комната чата: челлендж (рейтинг по очкам), командный фонарь (общий прогресс и вклад),
 * дуэль (двое, меньше ходов — победа). Время до конца, кнопка «Играть».
 */
export class RoomScene extends Phaser.Scene {
  private data_!: RoomData;
  private timerText!: Phaser.GameObjects.Text;
  /** Кнопки в пикселях canvas — для e2e. */
  buttons: { label: string; x: number; y: number }[] = [];

  constructor() {
    super('room');
  }

  create(data: RoomData): void {
    this.data_ = data;
    this.buttons = [];
    const { theme, dpr: k, view } = data;
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(theme.bg);
    const pw = Math.min(W - 24 * k, 400 * k);
    const x = (W - pw) / 2;
    const top = Math.max(telegram.insets().top * k + 16 * k, H * 0.08);
    const text = (px: number, y: number, s: string, size: number, color: string, bold = false, originX = 0.5) =>
      this.add.text(px, y, s, { fontFamily: FONT, fontSize: `${Math.round(size * k)}px`, color, fontStyle: bold ? 'bold' : 'normal' })
        .setOrigin(originX, 0.5);

    const team = view.mode === 'team' ? view.team ?? null : null;
    const duel = view.mode === 'duel' ? view.duel ?? null : null;
    const rows = duel ? Math.max(1, duel.players.length) + 1
      : Math.max(1, view.top.length) + (view.me.place && view.me.place > view.top.length ? 1 : 0);
    const ph = (220 + rows * 44 + 130 + (team ? 70 : 0)) * k;
    const panel = this.add.graphics().fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top, pw, ph, 24 * k);
    this.add.image(W / 2, top + 38 * k, 'lantern').setDisplaySize(52 * k, 52 * k);
    const creator = view.creatorName || '—';
    text(W / 2, top + 84 * k, team ? t.room.teamTitle : duel ? t.room.duelTitle : t.room.title, 24, theme.text, true);
    text(W / 2, top + 112 * k, team ? t.room.teamSubtitle(creator) : duel ? t.room.duelSubtitle(view.levelId, creator) : t.room.subtitle(view.levelId, creator), 14, theme.hint);
    this.timerText = text(W / 2, top + 136 * k, '', 14, theme.text, true);

    let y = top + 180 * k;
    if (team) {
      // общий прогресс фонаря
      const bw = pw - 56 * k;
      const frac = Math.min(1, team.progress / Math.max(1, team.target));
      this.add.graphics().fillStyle(hexToInt(theme.hint), 0.2).fillRoundedRect(x + 28 * k, y - 10 * k, bw, 20 * k, 10 * k)
        .fillStyle(0xffa94d, 1).fillRoundedRect(x + 28 * k, y - 10 * k, Math.max(20 * k, bw * frac), 20 * k, 10 * k);
      text(W / 2, y + 26 * k, t.room.teamProgress(Math.min(team.progress, team.target), team.target), 14, theme.text, true);
      text(W / 2, y + 48 * k, team.progress >= team.target ? t.room.teamDone : t.room.teamReward(rewardText(team.reward)), 12, theme.hint);
      y += 90 * k;
    }
    if (duel) {
      if (duel.players.length === 0) text(W / 2, y, t.room.duelWaiting, 15, theme.hint);
      duel.players.forEach((p, i) => {
        text(x + 34 * k, y, i === 0 && duel.winner ? '🏆' : '⚔️', 16, theme.text, true, 0);
        text(x + 72 * k, y, p.name || '—', 16, theme.text, duel.winner === p.name, 0);
        text(x + pw - 28 * k, y, p.won ? t.room.duelMoves(p.moves ?? 0) : t.room.duelLost, 16, theme.text, true, 1);
        y += 44 * k;
      });
      if (duel.players.length === 0) y += 44 * k;
      text(W / 2, y, duel.winner ? t.room.duelWinner(duel.winner) : t.room.teamReward(rewardText(duel.reward)), 14, theme.hint);
      y += 44 * k;
      const canPlay = !view.expired && !view.settled && !duel.full && view.me.attempts === 0;
      if (canPlay) this.button(t.room.duelAccept, y, true, data.onPlay);
      this.button(t.toMap, y + (canPlay ? 56 : 0) * k, !canPlay, data.onMap);
      panel.clear().fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, top, pw, y + (canPlay ? 90 : 34) * k - top, 24 * k);
      (globalThis as Record<string, unknown>).__sakuraRoom = this;
      return;
    }
    if (view.top.length === 0) {
      text(W / 2, y, t.room.empty, 15, theme.hint);
      y += 44 * k;
    }
    const row = (place: number, name: string, score: number, mine: boolean) => {
      if (mine) {
        this.add.graphics().fillStyle(hexToInt(theme.button), 0.18).fillRoundedRect(x + 14 * k, y - 18 * k, pw - 28 * k, 36 * k, 12 * k);
      }
      text(x + 34 * k, y, MEDALS[place - 1] ?? String(place), 16, theme.text, true, 0);
      text(x + 72 * k, y, mine ? `${name} (${t.room.you})` : name, 16, theme.text, mine, 0);
      text(x + pw - 28 * k, y, score.toLocaleString('ru-RU'), 16, theme.text, true, 1);
      y += 44 * k;
    };
    for (const r of view.top) row(r.place, r.name || '—', r.score, r.place === view.me.place);
    if (view.me.place && view.me.place > view.top.length && view.me.bestScore !== null) row(view.me.place, '…', view.me.bestScore, true);
    text(W / 2, y, t.room.players(view.players), 14, theme.hint);
    y += 44 * k;

    const primary = view.expired || view.settled ? null : view.nextAttemptFree ? t.room.playFree : t.room.playLife;
    if (primary) this.button(primary, y, true, data.onPlay);
    this.button(t.toMap, y + (primary ? 56 : 0) * k, !primary, data.onMap);
    (globalThis as Record<string, unknown>).__sakuraRoom = this;
  }

  private button(label: string, cy: number, primary: boolean, onClick: () => void): void {
    const { theme, dpr: k } = this.data_;
    const W = this.scale.width;
    const bw = Math.min(W - 72 * k, 340 * k);
    const bh = 46 * k;
    this.add.graphics()
      .fillStyle(primary ? hexToInt(theme.button) : hexToInt(theme.hint), primary ? 1 : 0.25)
      .fillRoundedRect(W / 2 - bw / 2, cy - bh / 2, bw, bh, bh / 2);
    this.add.text(W / 2, cy, label, {
      fontFamily: FONT, fontSize: `${Math.round(18 * k)}px`, fontStyle: 'bold', color: primary ? theme.buttonText : theme.text,
    }).setOrigin(0.5);
    this.add.zone(W / 2, cy, bw, bh).setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    this.buttons.push({ label, x: W / 2, y: cy });
  }

  override update(): void {
    const { view, clockOffset } = this.data_;
    const left = (view.expiresAt - clockOffset - Date.now()) / 1000;
    this.timerText.setText(view.expired || left <= 0 ? t.room.ended : t.room.endsIn(formatTime(left)));
  }
}
