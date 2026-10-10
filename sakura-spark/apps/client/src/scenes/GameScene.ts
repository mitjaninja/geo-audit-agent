import Phaser from 'phaser';
import { gameOptionsFromLevel, Match3Game } from '@sakura/core';
import type { CascadeStep, GameEvent, IntroLine, LevelDef, Pos, Swap } from '@sakura/core';
import type { ClientEvent, LivesView } from '../api.ts';
import { formatTime, t } from '../i18n.ts';
import { swipeToSwap, tap } from '../input.ts';
import { cellAt, cellCenter, computeLayout } from '../layout.ts';
import type { Layout } from '../layout.ts';
import { telegram } from '../telegram.ts';
import { HINT_DELAY_MS, pickHint, sameSwap, SPEAKERS } from '../tutorial.ts';
import type { SeenStore } from '../tutorial.ts';
import { pieceKey } from '../textures.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { Hud } from './hud.ts';

export interface GameSceneData {
  readonly level: LevelDef;
  readonly seed: number;
  readonly theme: Theme;
  /** Масштаб: canvas рисуется в device pixels (до 2×), координаты макета — в CSS px. */
  readonly dpr: number;
  /** Жизни для HUD; null — офлайн-режим без сервера. */
  readonly lives: LivesView | null;
  /** Итог партии: онлайн — от сервера (он проигрывает ходы сам), офлайн — локальный. */
  readonly onGameOver: (game: Match3Game, timedOut: boolean) => Promise<GameOverResult>;
  readonly onFinish: (action: 'next' | 'retry' | 'map' | 'room') => void;
  /** Партия в комнате чат-режима: итог — место в рейтинге чата, вступления не показываются. */
  readonly room: { readonly id: string } | null;
  /** Новичок из чата (PRD): подсказка хода сразу, на первых N ходах. */
  readonly eagerHints: number;
  /** Игрок вышел посреди уровня (попытка закрывается как проигрыш). */
  readonly onExit: (game: Match3Game) => Promise<void>;
  /** Уровни, где вступление и обучающий ход уже показаны. */
  readonly intros: SeenStore;
  /** Клиентская аналитика (подсказки, обучение). */
  readonly track: (event: ClientEvent) => void;
}

export interface GameOverResult {
  readonly won: boolean;
  readonly score: number;
  readonly stars: number;
  readonly lives: LivesView | null;
  readonly room?: { readonly place: number; readonly players: number };
}

const key = (p: Pos) => `${p.row},${p.col}`;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Длительности анимаций, мс. */
const T = { swap: 130, clear: 150, fx: 160, pop: 140, fallBase: 90, fallPerCell: 45, shuffle: 320 } as const;

export class GameScene extends Phaser.Scene {
  match!: Match3Game;
  layout!: Layout;
  private data_!: GameSceneData;
  private hud!: Hud;
  /** Модель того, что сейчас нарисовано: id фишки → клетка. Ведётся по событиям ядра. */
  private readonly posOf = new Map<number, Pos>();
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly cellImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly jellyImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly blockerImages = new Map<string, Phaser.GameObjects.Image>();
  private pieceLayer!: Phaser.GameObjects.Container;
  private maskShape!: Phaser.GameObjects.Graphics;
  private selectImage!: Phaser.GameObjects.Image;
  private selected: Pos | null = null;
  private pointerStart: { at: Pos; x: number; y: number; swiped: boolean } | null = null;
  private busy = false;
  private finished = false;
  private timeLeft: number | undefined;
  /**
   * Таймер считается по настенным часам, а не по delta Phaser: тот сглаживает и ограничивает шаг кадра,
   * и на медленном телефоне игровое время отстаёт от настоящего.
   */
  private deadline: number | undefined;
  private hiddenAt: number | undefined;
  private relayoutPending = false;
  /** Обучающий ход: пока он не сделан, другие ходы не принимаются. */
  gate: Swap | null = null;
  private tutorialObjects: Phaser.GameObjects.GameObject[] = [];
  private hintObjects: Phaser.GameObjects.GameObject[] = [];
  private hintTweens: Phaser.Tweens.Tween[] = [];
  private lastInput = 0;
  /** Идёт вступление — ввод закрыт. */
  onboarding = false;

  constructor() {
    super('game');
  }

  get idle(): boolean {
    return !this.busy;
  }

  create(data: GameSceneData): void {
    this.data_ = data;
    this.posOf.clear();
    this.sprites.clear();
    this.cellImages.clear();
    this.jellyImages.clear();
    this.blockerImages.clear();
    this.selected = null;
    this.busy = false;
    this.finished = false;
    this.match = new Match3Game(gameOptionsFromLevel(data.level, data.seed));
    this.timeLeft = data.level.timeLimit;
    // таймер запускается после вступления, чтобы реплики не съедали время
    this.deadline = undefined;
    this.gate = null;
    this.tutorialObjects = [];
    this.hintObjects = [];
    this.hintTweens = [];
    this.onboarding = false;
    this.cameras.main.setBackgroundColor(data.theme.bg);

    const board = this.match.board;
    for (const p of board.playableCells()) {
      this.cellImages.set(key(p), this.add.image(0, 0, 'cell').setDepth(0).setAlpha(data.theme.isDark ? 0.22 : 1));
    }
    this.pieceLayer = this.add.container(0, 0).setDepth(2);
    this.maskShape = this.make.graphics({}, false);
    this.pieceLayer.setMask(this.maskShape.createGeometryMask());
    this.selectImage = this.add.image(0, 0, 'select').setDepth(4).setVisible(false);
    this.hud = new Hud(this, data.level, data.theme, data.dpr, data.lives, () => this.confirmExit());

    this.computeLayout();
    this.syncFromCore(false);
    this.hud.place(this.layout);
    this.hud.update(this.match, this.timeLeft);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.scale.on('resize', this.onResize, this);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResize, this);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });

    (globalThis as Record<string, unknown>).__sakura = this;
    this.lastInput = this.time.now;
    void this.runOnboarding();
  }

  /** Свернули Mini App — таймер на паузе. */
  private readonly onVisibility = (): void => {
    if (this.deadline === undefined) return;
    if (document.hidden) this.hiddenAt = performance.now();
    else if (this.hiddenAt !== undefined) {
      this.deadline += performance.now() - this.hiddenAt;
      this.hiddenAt = undefined;
    }
  };

  override update(time: number): void {
    // новичку из чата — подсказка почти сразу на первых ходах, остальным — после паузы
    const hintDelay = this.match.history.length < this.data_.eagerHints ? 600 : HINT_DELAY_MS;
    if (!this.busy && !this.finished && !this.onboarding && !this.gate && this.hintObjects.length === 0
      && this.match.status === 'playing' && time - this.lastInput > hintDelay) {
      this.showHint();
    }
    if (this.deadline === undefined || this.finished || this.hiddenAt !== undefined) return;
    if (this.match.status !== 'playing') return;
    this.timeLeft = Math.max(0, (this.deadline - performance.now()) / 1000);
    this.hud.update(this.match, this.timeLeft);
    // время кончилось — ждём конца анимаций текущего хода, затем фиксируем поражение
    if (this.timeLeft === 0 && !this.busy) {
      this.match.timeUp();
      this.finish();
    }
  }

  // ---------- обучение и подсказки ----------

  private async runOnboarding(): Promise<void> {
    const { level, intros, room } = this.data_;
    // в комнате чата обучение не показываем: у всех одна и та же партия, а рейтинг идёт по очкам
    const first = !room && !intros.has(level.id);
    if (first && level.intro) {
      this.onboarding = true;
      await this.speak(level.intro);
      this.onboarding = false;
    }
    if (first && level.tutorial) {
      this.gate = level.tutorial.swap;
      this.showTutorial(level.tutorial.text, level.tutorial.swap);
    }
    if (first) intros.add(level.id);
    if (this.timeLeft !== undefined) this.deadline = performance.now() + this.timeLeft * 1000;
    this.lastInput = this.time.now;
  }

  /** Пузырь с репликой персонажа внизу экрана. */
  private bubble(line: IntroLine, hint: string | null): Phaser.GameObjects.GameObject[] {
    const { theme, dpr: k } = this.data_;
    const W = this.scale.width;
    const H = this.scale.height;
    const w = Math.min(W - 24 * k, 420 * k);
    const x = (W - w) / 2;
    // сначала текст: высота пузыря — по нему, чтобы длинная реплика не налезала на подсказку
    const text = this.add.text(0, 0, line.text, {
      fontFamily: FONT, fontSize: `${Math.round(15 * k)}px`, color: theme.text, wordWrap: { width: w - 100 * k },
    });
    const h = Math.max(112 * k, text.height + (hint ? 64 : 48) * k);
    const y = Math.min(H - h - 16 * k, this.layout.boardY + this.layout.cell * this.match.board.height + 12 * k);
    text.setPosition(x + 86 * k, y + 34 * k);
    const speaker = SPEAKERS[line.speaker];
    const panel = this.add.graphics().fillStyle(hexToInt(theme.panel), 0.97).fillRoundedRect(x, y, w, h, 20 * k)
      .lineStyle(3 * k, speaker.color, 1).strokeRoundedRect(x, y, w, h, 20 * k);
    const avatar = this.add.circle(x + 44 * k, y + h / 2, 30 * k, speaker.color).setStrokeStyle(3 * k, 0xffffff);
    const initial = this.add.text(x + 44 * k, y + h / 2, speaker.name[0]!, {
      fontFamily: FONT, fontSize: `${Math.round(24 * k)}px`, fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    const name = this.add.text(x + 86 * k, y + 14 * k, speaker.name, {
      fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, fontStyle: 'bold', color: theme.hint,
    });
    const objs: Phaser.GameObjects.GameObject[] = [panel, avatar, initial, name, text];
    if (hint) {
      objs.push(this.add.text(x + w - 14 * k, y + h - 10 * k, hint, {
        fontFamily: FONT, fontSize: `${Math.round(12 * k)}px`, color: theme.hint,
      }).setOrigin(1, 1));
    }
    for (const o of objs) (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(15);
    // текст создан раньше панели (её высота — по тексту), поэтому поднимаем его над ней
    text.setDepth(15.5);
    return objs;
  }

  /** Реплики по очереди; тап — следующая. */
  private async speak(lines: readonly IntroLine[]): Promise<void> {
    for (const line of lines) {
      const objs = this.bubble(line, t.tapToContinue);
      for (const o of objs) {
        const a = o as unknown as Phaser.GameObjects.Components.Alpha;
        a.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, duration: 180 });
      }
      await new Promise<void>((resolve) => this.input.once('pointerup', () => resolve()));
      for (const o of objs) o.destroy();
    }
  }

  /** Рука, которая тянет фишку из a в b. */
  private hand(swap: Swap): Phaser.GameObjects.Image {
    const a = this.at(swap.a);
    const b = this.at(swap.b);
    const cell = this.layout.cell;
    const hand = this.add.image(a.x, a.y, 'hand').setDisplaySize(cell * 0.75, cell * 0.75).setDepth(16);
    this.tweens.add({
      targets: hand, x: b.x, y: b.y, duration: 700, delay: 250,
      ease: 'Sine.easeInOut', repeat: -1, repeatDelay: 450,
    });
    return hand;
  }

  private showTutorial(text: string, swap: Swap): void {
    this.tutorialObjects = [...this.bubble({ speaker: 'mika', text }, null), this.hand(swap)];
  }

  /** Подсказка Пона после бездействия: пульсируют две фишки, рука показывает ход. */
  private showHint(): void {
    const swap = pickHint(this.match);
    if (!swap) return;
    this.data_.track({ name: 'hint_shown', levelId: this.data_.level.id, props: { movesLeft: this.match.movesLeft } });
    const ids = [this.idAt(swap.a), this.idAt(swap.b)];
    for (const id of ids) {
      const s = id === undefined ? undefined : this.sprites.get(id);
      if (s) this.hintTweens.push(this.tweens.add({ targets: s, scale: s.scale * 1.12, yoyo: true, repeat: -1, duration: 420 }));
    }
    this.hintObjects = [this.hand(swap)];
  }

  private clearHint(): void {
    for (const tw of this.hintTweens) tw.stop();
    this.hintTweens = [];
    for (const o of this.hintObjects) o.destroy();
    if (this.hintObjects.length > 0) this.syncFromCore(false);
    this.hintObjects = [];
  }

  // ---------- раскладка ----------

  private computeLayout(): void {
    const k = this.data_.dpr;
    const insets = telegram.insets();
    const css = computeLayout(
      { width: this.scale.width / k, height: this.scale.height / k, insetTop: insets.top, insetBottom: insets.bottom },
      this.match.board.width, this.match.board.height,
    );
    this.layout = {
      cell: css.cell * k, boardX: css.boardX * k, boardY: css.boardY * k,
      hud: { x: css.hud.x * k, y: css.hud.y * k, width: css.hud.width * k, height: css.hud.height * k },
    };
    const { boardX, boardY, cell } = this.layout;
    this.maskShape.clear().fillStyle(0xffffff).fillRect(boardX, boardY, cell * this.match.board.width, cell * this.match.board.height);
  }

  private onResize(): void {
    if (this.busy) {
      this.relayoutPending = true;
      return;
    }
    this.computeLayout();
    this.hud.place(this.layout);
    this.hud.update(this.match, this.timeLeft);
    this.syncFromCore(false);
  }

  private at(p: Pos): { x: number; y: number } {
    return cellCenter(this.layout, p);
  }

  private size(img: Phaser.GameObjects.Image, scale = 1): Phaser.GameObjects.Image {
    return img.setDisplaySize(this.layout.cell * scale, this.layout.cell * scale);
  }

  // ---------- синхронизация с ядром ----------

  /** Приводит картинку к состоянию ядра: фишки, слои желе и блокеров. */
  private syncFromCore(animate: boolean): void {
    const board = this.match.board;
    for (const p of board.playableCells()) {
      const c = this.at(p);
      this.size(this.cellImages.get(key(p))!.setPosition(c.x, c.y), 0.98);
      this.setJelly(p, this.match.jellyAt(p));
      const b = board.blockerAt(p);
      this.setBlocker(p, b ? (b.kind === 'fog' || b.kind === 'vines' ? b.kind : `${b.kind}${b.layers}`) : null);
    }
    const alive = new Set<number>();
    for (const p of board.playableCells()) {
      const piece = board.get(p);
      if (!piece) continue;
      alive.add(piece.id);
      const texture = pieceKey(piece.color, piece.special);
      let s = this.sprites.get(piece.id);
      if (!s) s = this.spawnSprite(piece.id, texture, p);
      s.setTexture(texture);
      this.posOf.set(piece.id, p);
      const c = this.at(p);
      if (animate && (s.x !== c.x || s.y !== c.y)) this.tweens.add({ targets: s, x: c.x, y: c.y, duration: T.shuffle });
      else s.setPosition(c.x, c.y);
      this.size(s, 0.9);
    }
    for (const [id, s] of this.sprites) {
      if (alive.has(id)) continue;
      s.destroy();
      this.sprites.delete(id);
      this.posOf.delete(id);
    }
    if (this.selected) this.showSelect(this.selected);
  }

  private spawnSprite(id: number, texture: string, p: Pos): Phaser.GameObjects.Image {
    const c = this.at(p);
    const s = this.size(this.add.image(c.x, c.y, texture), 0.9);
    this.pieceLayer.add(s);
    this.sprites.set(id, s);
    this.posOf.set(id, p);
    return s;
  }

  private setJelly(p: Pos, layers: number): void {
    const k = key(p);
    const img = this.jellyImages.get(k);
    if (layers === 0) {
      img?.destroy();
      this.jellyImages.delete(k);
      return;
    }
    const c = this.at(p);
    if (img) img.setTexture(`jelly${layers}`).setPosition(c.x, c.y);
    else this.jellyImages.set(k, this.add.image(c.x, c.y, `jelly${layers}`).setDepth(1));
    this.size(this.jellyImages.get(k)!, 0.96);
  }

  private setBlocker(p: Pos, texture: string | null): void {
    const k = key(p);
    const img = this.blockerImages.get(k);
    if (!texture) {
      img?.destroy();
      this.blockerImages.delete(k);
      return;
    }
    const c = this.at(p);
    if (img) img.setTexture(texture).setPosition(c.x, c.y);
    else this.blockerImages.set(k, this.add.image(c.x, c.y, texture).setDepth(3));
    this.size(this.blockerImages.get(k)!, 0.96);
  }

  private idAt(p: Pos): number | undefined {
    for (const [id, q] of this.posOf) if (q.row === p.row && q.col === p.col) return id;
    return undefined;
  }

  // ---------- ввод ----------

  private onDown(p: Phaser.Input.Pointer): void {
    this.lastInput = this.time.now;
    this.clearHint();
    if (this.busy || this.finished || this.onboarding) return;
    const at = cellAt(this.layout, p.x, p.y, this.match.board.width, this.match.board.height);
    this.pointerStart = at ? { at, x: p.x, y: p.y, swiped: false } : null;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const s = this.pointerStart;
    if (!s || s.swiped || !p.isDown) return;
    const swap = swipeToSwap(s.at, p.x - s.x, p.y - s.y, this.layout.cell);
    if (!swap) return;
    s.swiped = true;
    void this.trySwap(swap);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const s = this.pointerStart;
    this.pointerStart = null;
    if (!s || s.swiped || this.busy || this.finished) return;
    const at = cellAt(this.layout, p.x, p.y, this.match.board.width, this.match.board.height);
    if (!at) return;
    const r = tap(this.selected, at);
    if (r.kind === 'swap') void this.trySwap(r.swap);
    else if (r.kind === 'select') {
      if (!this.match.board.isMovable(r.at)) return;
      this.selected = r.at;
      this.showSelect(r.at);
      telegram.haptic('tap');
    } else {
      this.selected = null;
      this.selectImage.setVisible(false);
    }
  }

  private showSelect(p: Pos): void {
    const c = this.at(p);
    this.size(this.selectImage.setPosition(c.x, c.y).setVisible(true));
  }

  /** Ход игрока; также точка входа для e2e-теста. */
  async trySwap(swap: Swap): Promise<boolean> {
    if (this.busy || this.finished || this.onboarding || this.match.status !== 'playing') return false;
    if (this.gate && !sameSwap(swap, this.gate)) {
      // в обучении — только показанный ход
      telegram.haptic('error');
      return false;
    }
    if (this.gate) {
      this.data_.track({ name: 'tutorial_complete', levelId: this.data_.level.id });
      this.gate = null;
      for (const o of this.tutorialObjects) o.destroy();
      this.tutorialObjects = [];
    }
    this.clearHint();
    this.lastInput = this.time.now;
    this.selected = null;
    this.selectImage.setVisible(false);
    const res = this.match.swap(swap);
    this.busy = true;
    try {
      await this.play(res.events);
    } finally {
      this.busy = false;
    }
    if (!res.valid) telegram.haptic('error');
    this.syncFromCore(false);
    if (this.relayoutPending) {
      this.relayoutPending = false;
      this.onResize();
    }
    this.hud.update(this.match, this.timeLeft);
    // таймер мог истечь во время анимаций — поражение фиксируем только после хода
    if (this.timeLeft === 0 && this.match.status === 'playing') this.match.timeUp();
    if (this.match.status !== 'playing') this.finish();
    return res.valid;
  }

  // ---------- анимации ----------

  private tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({ ...cfg, onComplete: () => resolve() });
    });
  }

  private async play(events: readonly GameEvent[]): Promise<void> {
    for (const e of events) {
      switch (e.type) {
        case 'swap':
        case 'swapBack':
          await this.animateSwap(e.swap);
          break;
        case 'cascade':
          await this.animateStep(e.step, e.index);
          break;
        case 'shuffle':
          this.toast(t.noMoves);
          await Promise.all(e.moves.map((m) => {
            this.posOf.set(m.id, m.to);
            const s = this.sprites.get(m.id);
            const c = this.at(m.to);
            return s ? this.tween({ targets: s, x: c.x, y: c.y, duration: T.shuffle, ease: 'Sine.easeInOut' }) : Promise.resolve();
          }));
          break;
        case 'reset':
          this.syncFromCore(true);
          await this.wait(T.shuffle);
          break;
        case 'fogSpread': {
          const s = this.sprites.get(e.pieceId);
          this.posOf.delete(e.pieceId);
          this.sprites.delete(e.pieceId);
          this.setBlocker(e.to, 'fog');
          this.blockerImages.get(key(e.to))?.setScale(0.01);
          await Promise.all([
            s ? this.tween({ targets: s, alpha: 0, duration: T.clear }).then(() => s.destroy()) : Promise.resolve(),
            this.tween({ targets: this.blockerImages.get(key(e.to)), displayWidth: this.layout.cell * 0.96, displayHeight: this.layout.cell * 0.96, duration: T.pop * 2 }),
          ]);
          break;
        }
        case 'finale':
          if (e.bonus > 0) this.toast(t.bonus(e.bonus));
          break;
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private async animateSwap({ a, b }: Swap): Promise<void> {
    const ia = this.idAt(a);
    const ib = this.idAt(b);
    const moves: Promise<void>[] = [];
    if (ia !== undefined) {
      this.posOf.set(ia, b);
      moves.push(this.tween({ targets: this.sprites.get(ia), ...this.at(b), duration: T.swap, ease: 'Sine.easeInOut' }));
    }
    if (ib !== undefined) {
      this.posOf.set(ib, a);
      moves.push(this.tween({ targets: this.sprites.get(ib), ...this.at(a), duration: T.swap, ease: 'Sine.easeInOut' }));
    }
    await Promise.all(moves);
  }

  private async animateStep(step: CascadeStep, index: number): Promise<void> {
    // 1. срабатывания спецфишек
    if (step.activations.length > 0 || step.combo) telegram.haptic('big');
    else telegram.haptic('match');
    for (const a of step.activations) this.activationFx(a.at, a.special);
    if (step.combo) this.comboFx(step.combo);

    // 2. снятие фишек, удары по блокерам и желе
    const cleared = step.cleared.flatMap((p) => {
      const id = this.idAt(p);
      return id === undefined ? [] : [id];
    });
    for (const id of cleared) this.posOf.delete(id);
    const vanish = cleared.map((id) => {
      const s = this.sprites.get(id)!;
      this.sprites.delete(id);
      this.sparkle(s.x, s.y);
      return this.tween({ targets: s, scale: 0, alpha: 0, duration: T.clear, ease: 'Back.easeIn' }).then(() => s.destroy());
    });
    for (const h of step.blockersHit) {
      if (h.layersLeft === 0) {
        const img = this.blockerImages.get(key(h.at));
        this.blockerImages.delete(key(h.at));
        if (img) vanish.push(this.tween({ targets: img, alpha: 0, scale: img.scale * 1.3, duration: T.clear }).then(() => img.destroy()));
      } else {
        this.setBlocker(h.at, `${h.kind}${h.layersLeft}`);
      }
    }
    for (const p of step.jellyHit) this.setJelly(p, this.match.jellyAt(p));
    if (index > 0) this.toast(`×${index + 1}`, step.cleared[0]);
    await Promise.all(vanish);

    // 3. новые спецфишки
    await Promise.all(step.created.map(({ piece, at }) => {
      const s = this.spawnSprite(piece.id, pieceKey(piece.color, piece.special), at).setScale(0.01);
      return this.tween({ targets: s, displayWidth: this.layout.cell * 0.9, displayHeight: this.layout.cell * 0.9, duration: T.pop, ease: 'Back.easeOut' });
    }));

    // 4. падение, собранные фонарики, досыпка сверху
    const lastTo = new Map<number, Pos>();
    for (const f of step.falls) lastTo.set(f.id, f.to);
    const motion: Promise<void>[] = [];
    for (const [id, to] of lastTo) {
      const from = this.posOf.get(id);
      this.posOf.set(id, to);
      const s = this.sprites.get(id);
      if (!s) continue;
      const c = this.at(to);
      const cells = from ? Math.abs(to.row - from.row) + Math.abs(to.col - from.col) : 1;
      motion.push(this.tween({ targets: s, x: c.x, y: c.y, duration: T.fallBase + T.fallPerCell * cells, ease: 'Quad.easeIn' }));
    }
    for (const l of step.lanternsCollected) {
      const s = this.sprites.get(l.id);
      this.sprites.delete(l.id);
      this.posOf.delete(l.id);
      if (s) motion.push(this.tween({ targets: s, y: s.y + this.layout.cell, alpha: 0, duration: T.clear * 2 }).then(() => s.destroy()));
    }
    const perCol = new Map<number, number>();
    for (const sp of step.spawns) perCol.set(sp.at.col, (perCol.get(sp.at.col) ?? 0) + 1);
    for (const sp of step.spawns) {
      const n = perCol.get(sp.at.col)!;
      const s = this.spawnSprite(sp.piece.id, pieceKey(sp.piece.color, sp.piece.special), sp.at);
      const c = this.at(sp.at);
      s.setY(c.y - n * this.layout.cell);
      motion.push(this.tween({ targets: s, y: c.y, duration: T.fallBase + T.fallPerCell * n, ease: 'Quad.easeIn' }));
    }
    await Promise.all(motion);
    this.hud.update(this.match, this.timeLeft);
  }

  private activationFx(p: Pos, special: string): void {
    const c = this.at(p);
    const { boardX, boardY, cell } = this.layout;
    const w = cell * this.match.board.width;
    const h = cell * this.match.board.height;
    if (special === 'lineH' || special === 'lineV') {
      const beam = this.add.image(special === 'lineH' ? boardX + w / 2 : c.x, special === 'lineH' ? c.y : boardY + h / 2, 'beam').setDepth(5);
      if (special === 'lineH') beam.setDisplaySize(w, cell);
      else beam.setDisplaySize(h, cell).setAngle(90);
      this.tweens.add({ targets: beam, alpha: 0, duration: T.fx * 2, onComplete: () => beam.destroy() });
    } else {
      const ring = this.add.circle(c.x, c.y, cell * 0.5, 0xfff3b0, 0.8).setDepth(5);
      const r = special === 'bomb' ? 3 : 6;
      this.tweens.add({ targets: ring, scale: r, alpha: 0, duration: T.fx * 2, onComplete: () => ring.destroy() });
    }
  }

  private comboFx(combo: string): void {
    this.cameras.main.shake(combo === 'sakuraStorm' ? 300 : 150, combo === 'sakuraStorm' ? 0.012 : 0.006);
    this.cameras.main.flash(120, 255, 240, 250);
  }

  private sparkle(x: number, y: number): void {
    const s = this.add.image(x, y, 'spark').setDepth(5);
    this.size(s, 0.5);
    this.tweens.add({ targets: s, angle: 90, alpha: 0, scale: s.scale * 1.8, duration: T.fx * 2, onComplete: () => s.destroy() });
  }

  private toast(text: string, at?: Pos): void {
    const k = this.data_.dpr;
    const c = at ? this.at(at) : { x: this.scale.width / 2, y: this.layout.boardY + this.layout.cell * 1.5 };
    const label = this.add.text(c.x, c.y, text, {
      fontFamily: FONT, fontSize: `${Math.round(22 * k)}px`, fontStyle: 'bold', color: '#ffffff',
      stroke: '#ff6fa8', strokeThickness: 5 * k,
    }).setOrigin(0.5).setDepth(8);
    this.tweens.add({ targets: label, y: c.y - 40 * k, alpha: 0, delay: 350, duration: 600, onComplete: () => label.destroy() });
  }

  // ---------- конец партии ----------

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const local: GameOverResult = {
      won: this.match.status === 'won', score: this.match.score, stars: this.match.stars, lives: this.data_.lives,
    };
    const started = Date.now();
    this.data_.onGameOver(this.match, this.timeLeft === 0)
      .catch(() => local)
      .then((result) => {
        telegram.haptic(result.won ? 'success' : 'error');
        const pause = Math.max(0, (result.won ? 700 : 300) - (Date.now() - started));
        this.time.delayedCall(pause, () => this.showResult(result));
      });
  }

  /** Модальное окно поверх поля: заголовок, тело, кнопки. Возвращает функцию закрытия. */
  private dialog(opts: {
    title: string;
    height: number;
    body?: (y: number, w: number) => Phaser.GameObjects.GameObject[];
    buttons: { label: string; primary: boolean; onClick: () => void }[];
  }): () => void {
    const { theme, dpr: k } = this.data_;
    const W = this.scale.width;
    const H = this.scale.height;
    const pw = Math.min(W - 40 * k, 320 * k);
    const ph = opts.height * k;
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0).setInteractive();
    const panel = this.add.graphics().fillStyle(hexToInt(theme.panel), 1).fillRoundedRect(x, y, pw, ph, 24 * k);
    const title = this.add.text(W / 2, y + 36 * k, opts.title, {
      fontFamily: FONT, fontSize: `${Math.round(24 * k)}px`, fontStyle: 'bold', color: theme.text,
    }).setOrigin(0.5);
    const body = opts.body?.(y, pw) ?? [];
    const bw = pw - 48 * k;
    const bh = 46 * k;
    const buttons = opts.buttons.flatMap((b, i) => {
      const cy = y + ph - (opts.buttons.length - i) * 56 * k + 12 * k - 8 * k;
      const g = this.add.graphics()
        .fillStyle(b.primary ? hexToInt(theme.button) : hexToInt(theme.hint), b.primary ? 1 : 0.25)
        .fillRoundedRect(W / 2 - bw / 2, cy - bh / 2, bw, bh, bh / 2);
      const txt = this.add.text(W / 2, cy, b.label, {
        fontFamily: FONT, fontSize: `${Math.round(18 * k)}px`, fontStyle: 'bold', color: b.primary ? theme.buttonText : theme.text,
      }).setOrigin(0.5);
      const hit = this.add.zone(W / 2, cy, bw, bh).setInteractive({ useHandCursor: true });
      hit.on('pointerup', b.onClick);
      return [g, txt, hit];
    });
    const all = [dim, panel, title, ...body, ...buttons];
    for (const o of all) (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(20);
    this.dialogButtons = opts.buttons.map((b, i) => ({ label: b.label, x: W / 2, y: y + ph - (opts.buttons.length - i) * 56 * k + 4 * k }));
    return () => {
      for (const o of all) o.destroy();
      this.dialogButtons = [];
    };
  }

  /** Кнопки открытого диалога в пикселях canvas — для e2e. */
  dialogButtons: { label: string; x: number; y: number }[] = [];

  private showResult(result: GameOverResult): void {
    const { won } = result;
    const { theme, dpr: k } = this.data_;
    const W = this.scale.width;
    const lives = result.lives;
    const livesLine = !lives ? '' : lives.infiniteUntil ? t.livesInfinite
      : `${t.lives(lives.lives, lives.max)}${!won && lives.nextLifeAt ? ` · ${t.nextLife(formatTime((lives.nextLifeAt - Date.now()) / 1000))}` : ''}`;
    const finish = this.data_.onFinish;
    let stars: Phaser.GameObjects.Image[] = [];
    if (result.room) {
      this.dialog({
        title: t.room.place(result.room.place, result.room.players),
        height: 360,
        body: (y) => {
          stars = [0, 1, 2].map((i) => this.add.image(W / 2 + (i - 1) * 70 * k, y + 100 * k - (i === 1 ? 10 * k : 0), 'star')
            .setDisplaySize(62 * k, 62 * k).setTint(i < result.stars ? 0xffc93c : 0xd9d2e3));
          return [...stars, this.add.text(W / 2, y + 150 * k, `${t.score}: ${result.score}${livesLine ? `\n${livesLine}` : ''}`, {
            fontFamily: FONT, fontSize: `${Math.round(16 * k)}px`, color: theme.hint, align: 'center',
          }).setOrigin(0.5)];
        },
        buttons: [
          { label: t.room.toRanking, primary: true, onClick: () => finish('room') },
          { label: t.retry, primary: false, onClick: () => finish('retry') },
          { label: t.toMap, primary: false, onClick: () => finish('map') },
        ],
      });
      return;
    }
    this.dialog({
      title: won ? t.win : t.lose,
      height: won ? 360 : 320,
      body: (y) => {
        stars = [0, 1, 2].map((i) => this.add.image(W / 2 + (i - 1) * 70 * k, y + 100 * k - (i === 1 ? 10 * k : 0), 'star')
          .setDisplaySize(62 * k, 62 * k).setTint(i < result.stars ? 0xffc93c : 0xd9d2e3));
        const score = this.add.text(W / 2, y + 150 * k, `${t.score}: ${result.score}${livesLine ? `\n${livesLine}` : ''}`, {
          fontFamily: FONT, fontSize: `${Math.round(16 * k)}px`, color: theme.hint, align: 'center',
        }).setOrigin(0.5);
        return [...stars, score];
      },
      buttons: won
        ? [{ label: t.next, primary: true, onClick: () => finish('next') },
          { label: t.retry, primary: false, onClick: () => finish('retry') },
          { label: t.toMap, primary: false, onClick: () => finish('map') }]
        : [{ label: t.retry, primary: true, onClick: () => finish('retry') },
          { label: t.toMap, primary: false, onClick: () => finish('map') }],
    });
    stars.forEach((s, i) => {
      const target = s.scale;
      s.setScale(0.01);
      this.tweens.add({ targets: s, scale: target, delay: 150 + i * 160, duration: 260, ease: 'Back.easeOut' });
    });
  }

  /** Выход посреди уровня: подтверждение, потом партия закрывается как брошенная. */
  private confirmExit(): void {
    // во время реплик тап по ✕ только листает их
    if (this.finished || this.busy || this.onboarding) return;
    const { theme, dpr: k } = this.data_;
    const W = this.scale.width;
    const close = this.dialog({
      title: t.exitTitle,
      height: 250,
      body: (y, pw) => [this.add.text(W / 2, y + 70 * k, t.exitText, {
        fontFamily: FONT, fontSize: `${Math.round(15 * k)}px`, color: theme.hint, align: 'center', wordWrap: { width: pw - 40 * k },
      }).setOrigin(0.5, 0)],
      buttons: [
        { label: t.exitNo, primary: true, onClick: () => close() },
        {
          label: t.exitYes, primary: false, onClick: () => {
            close();
            this.finished = true;
            void this.data_.onExit(this.match);
          },
        },
      ],
    });
  }
}
