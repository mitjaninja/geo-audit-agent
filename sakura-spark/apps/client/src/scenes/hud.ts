import Phaser from 'phaser';
import type { GoalProgress, LevelDef, Match3Game } from '@sakura/core';
import type { LivesView } from '../api.ts';
import { formatTime, goalLabel, t } from '../i18n.ts';
import type { Layout } from '../layout.ts';
import { pieceKey } from '../textures.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function goalIcon(g: GoalProgress): string {
  switch (g.goal.type) {
    case 'collect': return pieceKey(g.goal.color, 'none');
    case 'jelly': return 'jelly2';
    case 'lanterns': return 'lantern';
    case 'fog': return 'fog';
    case 'score': return 'star';
  }
}

/** Верхняя панель: уровень, ходы или таймер, очки с полосой звёзд, цели. */
export class Hud {
  private readonly root: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly counterLabel: Phaser.GameObjects.Text;
  private readonly counter: Phaser.GameObjects.Text;
  private readonly score: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly exit: Phaser.GameObjects.Text;
  private readonly exitBg: Phaser.GameObjects.Arc;
  private readonly goals: { icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text; check: Phaser.GameObjects.Text }[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly level: LevelDef,
    private readonly theme: Theme,
    private readonly k: number,
    private readonly lives: LivesView | null,
    onExit: () => void,
  ) {
    const text = (size: number, color = theme.text, bold = false) => scene.add.text(0, 0, '', {
      fontFamily: FONT, fontSize: `${Math.round(size * k)}px`, color, fontStyle: bold ? 'bold' : 'normal',
    });
    this.panel = scene.add.graphics();
    this.title = text(13, theme.hint);
    this.counterLabel = text(12, theme.hint);
    this.counter = text(30, theme.text, true);
    this.score = text(15, theme.text, true);
    this.bar = scene.add.graphics();
    this.goals = level.goals.map(() => ({
      icon: scene.add.image(0, 0, 'spark'),
      text: text(17, theme.text, true),
      check: text(18, '#2fbf71', true).setText('✓'),
    }));
    this.exitBg = scene.add.circle(0, 0, 15 * k, hexToInt(theme.hint), 0.18);
    this.exit = scene.add.text(0, 0, '✕', {
      fontFamily: FONT, fontSize: `${Math.round(17 * k)}px`, fontStyle: 'bold', color: theme.text,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerup', onExit);
    // зона нажатия больше значка — по нему попадают пальцем
    this.exit.input!.hitArea.setTo(-14 * k, -14 * k, this.exit.width + 28 * k, this.exit.height + 28 * k);
    this.root = scene.add.container(0, 0, [this.exitBg, this.exit,
      this.panel, this.title, this.counterLabel, this.counter, this.score, this.bar,
      ...this.goals.flatMap((g) => [g.icon, g.text, g.check]),
    ]);
    this.root.setDepth(10);
  }

  place(l: Layout): void {
    const { x, y, width, height } = l.hud;
    const k = this.k;
    this.panel.clear();
    this.panel.fillStyle(hexToInt(this.theme.panel), this.theme.isDark ? 0.9 : 0.85);
    this.panel.fillRoundedRect(x, y, width, height, 18 * k);

    const left = x + 14 * k;
    const lv = this.lives;
    const livesText = !lv ? '' : lv.infiniteUntil ? `   ${t.livesInfinite}` : `   ${t.lives(lv.lives, lv.max)}`;
    this.title.setPosition(left, y + 10 * k).setText(t.level(this.level.id) + livesText);
    this.counterLabel.setPosition(left, y + 30 * k).setText(this.level.timeLimit ? t.time : t.moves);
    this.counter.setPosition(left, y + 44 * k);
    this.exit.setPosition(x + width - 24 * k, y + 24 * k);
    this.exitBg.setPosition(x + width - 24 * k, y + 24 * k);
    this.score.setPosition(x + width - 44 * k, y + 10 * k).setOrigin(1, 0);

    const n = this.goals.length;
    const gx = x + 100 * k;
    const slot = (width - 100 * k - 14 * k) / Math.max(n, 1);
    const iconSize = Math.min(40 * k, slot * 0.45);
    this.goals.forEach((g, i) => {
      const cx = gx + slot * (i + 0.5);
      const cy = y + height * 0.55;
      g.icon.setPosition(cx - iconSize * 0.45, cy).setDisplaySize(iconSize, iconSize);
      g.text.setPosition(cx + iconSize * 0.15, cy).setOrigin(0, 0.5);
      g.check.setPosition(cx + iconSize * 0.15, cy).setOrigin(0, 0.5);
    });
    this.barRect = { x: x + 14 * k, y: y + height - 16 * k, w: width - 28 * k, h: 7 * k };
  }

  private barRect = { x: 0, y: 0, w: 0, h: 0 };

  update(game: Match3Game, timeLeft?: number): void {
    this.counter.setText(timeLeft !== undefined ? formatTime(timeLeft) : String(game.movesLeft));
    const low = timeLeft !== undefined ? timeLeft <= 10 : game.movesLeft <= 3;
    this.counter.setColor(low ? '#ff5470' : this.theme.text);
    this.score.setText(`${t.score}: ${game.score}`);

    game.goalProgress().forEach((g, i) => {
      const view = this.goals[i]!;
      view.icon.setTexture(goalIcon(g));
      if (g.goal.type === 'score') view.icon.setTint(0xffc93c);
      view.text.setText(g.goal.type === 'score' ? `${Math.min(g.current, g.target)}/${g.target}` : String(Math.max(0, g.target - g.current)));
      view.text.setVisible(!g.done);
      view.check.setVisible(g.done);
    });

    // полоса очков с отметками трёх звёзд
    const { x, y, w, h } = this.barRect;
    const max = this.level.stars[2] * 1.1;
    this.bar.clear();
    this.bar.fillStyle(hexToInt(this.theme.hint), 0.3);
    this.bar.fillRoundedRect(x, y, w, h, h / 2);
    this.bar.fillStyle(hexToInt(this.theme.button), 1);
    this.bar.fillRoundedRect(x, y, Math.max(h, (w * Math.min(game.score, max)) / max), h, h / 2);
    for (const s of this.level.stars) {
      this.bar.fillStyle(game.score >= s ? 0xffc93c : hexToInt(this.theme.hint), 1);
      this.bar.fillCircle(x + (w * s) / max, y + h / 2, h * 0.9);
    }
  }
}
