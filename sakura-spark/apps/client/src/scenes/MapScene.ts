import Phaser from 'phaser';
import type { LivesView } from '../api.ts';
import { districtKey } from '../art.ts';
import { formatTime, t } from '../i18n.ts';
import { episodeLit, episodes, LEVELS_PER_EPISODE, mapGeometry, nodeState, starsInEpisode } from '../map.ts';
import type { MapGeometry } from '../map.ts';
import { telegram } from '../telegram.ts';
import { pieceKey } from '../textures.ts';
import { avatarColor } from './FriendsScene.ts';
import { hexToInt } from '../theme.ts';
import type { Theme } from '../theme.ts';

export interface MapData {
  readonly theme: Theme;
  readonly dpr: number;
  readonly levelCount: number;
  readonly maxLevel: number;
  readonly stars: Readonly<Record<string, { readonly stars: number }>>;
  readonly lives: LivesView | null;
  /** Уровень, к которому прокрутить карту (по умолчанию — текущий). */
  readonly focus?: number;
  readonly onPlay: (levelId: number) => void;
  /** «Позвать в чат» — создать челлендж и отправить карточку; null — офлайн. */
  readonly onShare: (() => void) | null;
  /** Кристаллы и вход в магазин; null — офлайн. */
  readonly crystals: number | null;
  readonly onShop: (() => void) | null;
  /** Награды дня и колесо; badge — есть что забрать. null — офлайн. */
  readonly onDaily?: (() => void) | null;
  readonly dailyBadge?: boolean;
  readonly onWheel?: (() => void) | null;
  readonly wheelBadge?: boolean;
  /** Друзья на карте (PRD): аватар стоит на их текущем уровне. */
  readonly friends?: readonly { readonly id: number; readonly name: string; readonly maxLevel: number }[];
  readonly onFriends?: (() => void) | null;
  readonly friendsBadge?: boolean;
  readonly onRace?: (() => void) | null;
  readonly raceBadge?: boolean;
  readonly onSeason?: (() => void) | null;
  readonly seasonBadge?: boolean;
  readonly onFestival?: (() => void) | null;
  readonly festivalBadge?: boolean;
  /** Цвет рамки аватара (коллекция); null — без рамки. */
  readonly frameColor?: number | null;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TAP_SLOP = 10;

/** Карта-тропа по районам Хоширо. Уровень 1 внизу, путь петляет вверх; тап по узлу — играть. */
export class MapScene extends Phaser.Scene {
  private data_!: MapData;
  private geo!: MapGeometry;
  private drag: { y: number; scroll: number; moved: number } | null = null;
  private livesText!: Phaser.GameObjects.Text;
  /** Кнопка «В чат» в пикселях canvas — для e2e. */
  shareButton: { x: number; y: number } | null = null;
  shopButton: { x: number; y: number } | null = null;
  dailyButton: { x: number; y: number } | null = null;
  wheelButton: { x: number; y: number } | null = null;
  friendsButton: { x: number; y: number } | null = null;
  raceButton: { x: number; y: number } | null = null;
  seasonButton: { x: number; y: number } | null = null;
  festivalButton: { x: number; y: number } | null = null;
  /** Нажатие по кнопке поверх карты — чтобы тап не попал в узел уровня под ней. */
  private shareTapped = false;

  constructor() {
    super('map');
  }

  /**
   * Арт района в полосе: картинка «cover», обрезанная по полосе. Пройденный район — ярко,
   * впереди — приглушённо и в серой дымке, как район, который ещё не зажёгся.
   */
  private districtArt(episode: number, x: number, y: number, w: number, h: number, lit: boolean): void {
    const texture = districtKey(episode);
    if (!this.textures.exists(texture)) return;
    const img = this.add.image(x + w / 2, y + h / 2, texture);
    const scale = Math.max(w / img.width, h / img.height);
    img.setScale(scale);
    const cw = w / scale;
    const ch = h / scale;
    img.setCrop((img.width - cw) / 2, (img.height - ch) / 2, cw, ch);
    if (lit) img.setAlpha(this.data_.theme.isDark ? 0.75 : 0.9);
    else img.setAlpha(this.data_.theme.isDark ? 0.3 : 0.45).setTint(0xb8b0c8);
  }

  create(data: MapData): void {
    this.data_ = data;
    this.shareButton = null;
    this.shopButton = null;
    this.shareTapped = false;
    // сцену остановили посреди нажатия (кнопка открыла другой экран) — старое касание не должно стать тапом
    this.drag = null;
    const { theme, dpr: k, levelCount, maxLevel, stars } = data;
    const W = this.scale.width;
    const H = this.scale.height;
    this.geo = mapGeometry(levelCount, W, k);
    const g = this.geo;
    this.cameras.main.setBackgroundColor(theme.bg).setBounds(0, 0, W, Math.max(g.height, H));

    // районы
    for (const e of episodes(levelCount)) {
      const band = g.band(e);
      const lit = episodeLit(e, maxLevel);
      this.add.graphics()
        .fillStyle(e.tint, lit ? 0.55 : theme.isDark ? 0.12 : 0.25)
        .fillRoundedRect(10 * k, band.top, W - 20 * k, band.bottom - band.top, 28 * k);
      this.districtArt(e.id, 10 * k, band.top, W - 20 * k, band.bottom - band.top, lit);
      // подложка под названием — читается поверх арта
      this.add.graphics().fillStyle(hexToInt(theme.panel), 0.82).fillRoundedRect(W / 2 - 110 * k, band.top + 8 * k, 220 * k, 54 * k, 18 * k);
      const total = (e.to - e.from + 1) * 3;
      this.add.text(W / 2, band.top + 26 * k, e.name, {
        fontFamily: FONT, fontSize: `${Math.round(20 * k)}px`, fontStyle: 'bold', color: theme.text,
      }).setOrigin(0.5);
      this.add.text(W / 2, band.top + 50 * k, `★ ${starsInEpisode(e, stars)}/${total}`, {
        fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: theme.hint,
      }).setOrigin(0.5);
      // зажжённый район: расцвела сакура — лепестки по полосе
      if (lit) {
        const rnd = new Phaser.Math.RandomDataGenerator([`ep${e.id}`]);
        for (let i = 0; i < 14; i++) {
          const p = this.add.image(rnd.between(24, W / k - 24) * k, rnd.between(band.top + 70 * k, band.bottom - 20 * k), pieceKey(3, 'none'))
            .setDisplaySize(18 * k, 18 * k).setAlpha(0.55).setAngle(rnd.angle());
          this.tweens.add({ targets: p, angle: p.angle + 40, y: p.y + 8 * k, yoyo: true, repeat: -1, duration: rnd.between(1800, 3200), ease: 'Sine.easeInOut' });
        }
      }
    }

    // тропа
    const path = this.add.graphics().lineStyle(10 * k, 0xffffff, theme.isDark ? 0.25 : 0.8);
    for (let id = 1; id < levelCount; id++) {
      const a = g.node(id);
      const b = g.node(id + 1);
      path.lineBetween(a.x, a.y, b.x, b.y);
    }

    // узлы
    const r = 26 * k;
    for (let id = 1; id <= levelCount; id++) {
      const { x, y } = g.node(id);
      const s = stars[id]?.stars ?? 0;
      const state = nodeState(id, maxLevel, s);
      const node = this.add.graphics();
      if (state === 'locked') node.fillStyle(theme.isDark ? 0x4a4360 : 0xd9d2e3, 1).fillCircle(x, y, r);
      else if (state === 'done') node.fillStyle(hexToInt(theme.button), 1).fillCircle(x, y, r);
      else node.fillStyle(0xffffff, 1).fillCircle(x, y, r).lineStyle(5 * k, hexToInt(theme.button), 1).strokeCircle(x, y, r);
      this.add.text(x, y, String(id), {
        fontFamily: FONT, fontSize: `${Math.round(18 * k)}px`, fontStyle: 'bold',
        color: state === 'done' ? theme.buttonText : state === 'current' ? '#3b2a4a' : theme.hint,
      }).setOrigin(0.5);
      if (state === 'done') {
        for (let i = 0; i < 3; i++) {
          this.add.image(x + (i - 1) * 17 * k, y + r + 8 * k - (i === 1 ? 3 * k : 0), 'star')
            .setDisplaySize(16 * k, 16 * k).setTint(i < s ? 0xffc93c : 0xb9b0c8);
        }
      }
      if (id % LEVELS_PER_EPISODE === 0 || id === levelCount) {
        // финал района — чуть крупнее, чтобы выделялся
        node.lineStyle(3 * k, 0xffc93c, 1).strokeCircle(x, y, r + 5 * k);
      }
    }

    // Мика у текущего уровня
    const current = Math.min(maxLevel, levelCount);
    const c = g.node(current);
    const ring = this.add.circle(c.x, c.y, r, 0xffffff, 0).setStrokeStyle(4 * k, hexToInt(theme.button), 0.9);
    this.tweens.add({ targets: ring, scale: 1.35, alpha: 0, duration: 1100, repeat: -1 });
    const mika = this.add.container(c.x, c.y - r - 30 * k, [
      this.add.circle(0, 0, 20 * k, 0xff9ec7).setStrokeStyle(data.frameColor ? 5 * k : 3 * k, data.frameColor ?? 0xffffff),
      this.add.text(0, 0, t.mikaInitial, { fontFamily: FONT, fontSize: `${Math.round(18 * k)}px`, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5),
    ]);
    this.tweens.add({ targets: mika, y: mika.y - 6 * k, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });

    // закреплённая панель сверху
    const insets = telegram.insets();
    const barY = insets.top * k + 8 * k;
    this.add.graphics().setScrollFactor(0).setDepth(10)
      .fillStyle(hexToInt(theme.panel), 0.92).fillRoundedRect(12 * k, barY, W - 24 * k, 48 * k, 16 * k);
    this.livesText = this.add.text(24 * k, barY + 24 * k, '', {
      fontFamily: FONT, fontSize: `${Math.round(14 * k)}px`, fontStyle: 'bold', color: theme.text,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    const totalStars = Object.values(stars).reduce((sum, v) => sum + v.stars, 0);
    const right = this.add.text(W - 28 * k, barY + 24 * k, `${data.crystals !== null ? `💎 ${data.crystals}   ` : ''}★ ${totalStars}`, {
      fontFamily: FONT, fontSize: `${Math.round(16 * k)}px`, fontStyle: 'bold', color: theme.text,
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11);
    if (data.onShop) {
      const open = data.onShop;
      right.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        this.shareTapped = true;
        open();
      });
      this.shopButton = { x: right.x - right.width / 2, y: right.y };
    }

    if (data.onShare) {
      const bw = 112 * k;
      const bh = 34 * k;
      const bx = W / 2;
      const by = barY + 24 * k;
      this.add.graphics().setScrollFactor(0).setDepth(11)
        .fillStyle(hexToInt(theme.button), 1).fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 2);
      this.add.text(bx, by, t.share.invite, {
        fontFamily: FONT, fontSize: `${Math.round(14 * k)}px`, fontStyle: 'bold', color: theme.buttonText,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(12);
      const share = data.onShare;
      this.add.zone(bx, by, bw, bh).setScrollFactor(0).setDepth(12).setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          this.shareTapped = true;
          share();
        });
      this.shareButton = { x: bx, y: by };
    }

    // круглые кнопки меты справа под панелью
    const round = (icon: string, cy: number, badge: boolean, onTap: () => void) => {
      const cx = W - 40 * k;
      const r = 24 * k;
      this.add.circle(cx, cy, r, hexToInt(theme.panel), 0.95).setStrokeStyle(2 * k, hexToInt(theme.button)).setScrollFactor(0).setDepth(11);
      this.add.text(cx, cy, icon, { fontFamily: FONT, fontSize: `${Math.round(22 * k)}px` }).setOrigin(0.5).setScrollFactor(0).setDepth(12);
      if (badge) this.add.circle(cx + r * 0.7, cy - r * 0.7, 6 * k, 0xff3b5c).setStrokeStyle(2 * k, 0xffffff).setScrollFactor(0).setDepth(13);
      this.add.zone(cx, cy, r * 2, r * 2).setScrollFactor(0).setDepth(12).setInteractive({ useHandCursor: true }).on('pointerup', () => {
        this.shareTapped = true;
        onTap();
      });
      return { x: cx, y: cy };
    };
    this.dailyButton = data.onDaily ? round('🎁', barY + 84 * k, data.dailyBadge === true, data.onDaily) : null;
    this.wheelButton = data.onWheel ? round('🎡', barY + 142 * k, data.wheelBadge === true, data.onWheel) : null;
    this.friendsButton = data.onFriends ? round('👥', barY + 200 * k, data.friendsBadge === true, data.onFriends) : null;
    this.raceButton = data.onRace ? round('🏁', barY + 258 * k, data.raceBadge === true, data.onRace) : null;
    this.seasonButton = data.onSeason ? round('🎫', barY + 316 * k, data.seasonBadge === true, data.onSeason) : null;
    this.festivalButton = data.onFestival ? round('🏮', barY + 374 * k, data.festivalBadge === true, data.onFestival) : null;

    // друзья на своих уровнях: до трёх кружков у узла, сбоку от тропы
    const byLevel = new Map<number, { id: number; name: string }[]>();
    for (const f of data.friends ?? []) {
      const lv = Math.min(Math.max(1, f.maxLevel), levelCount);
      byLevel.set(lv, [...(byLevel.get(lv) ?? []), f]);
    }
    for (const [lv, fs] of byLevel) {
      const n = g.node(lv);
      const side = n.x < W / 2 ? 1 : -1;
      fs.slice(0, 3).forEach((f, i) => {
        const ax = n.x + side * (r + 20 * k + i * 22 * k);
        const ay = n.y + 14 * k;
        this.add.circle(ax, ay, 15 * k, avatarColor(f.id)).setStrokeStyle(2 * k, 0xffffff).setDepth(2);
        this.add.text(ax, ay, (f.name || '?').slice(0, 1).toUpperCase(), {
          fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, fontStyle: 'bold', color: '#ffffff',
        }).setOrigin(0.5).setDepth(3);
      });
    }

    const focus = g.node(Math.min(data.focus ?? current, levelCount));
    this.cameras.main.setScroll(0, focus.y - H * 0.6);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.drag = { y: p.y, scroll: this.cameras.main.scrollY, moved: 0 };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      this.drag.moved = Math.max(this.drag.moved, Math.abs(p.y - this.drag.y));
      this.cameras.main.setScroll(0, this.drag.scroll - (p.y - this.drag.y));
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      this.drag = null;
      if (this.shareTapped) {
        this.shareTapped = false;
        return;
      }
      if (!d || d.moved > TAP_SLOP * k) return;
      const id = this.levelAt(p.worldX, p.worldY);
      if (id !== null) this.tapLevel(id);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.cameras.main.setScroll(0, this.cameras.main.scrollY + dy);
    });
    (globalThis as Record<string, unknown>).__sakuraMap = this;
  }

  override update(): void {
    const l = this.data_.lives;
    if (!l) {
      this.livesText.setText('');
      return;
    }
    if (l.infiniteUntil) {
      this.livesText.setText(t.livesInfinite);
      return;
    }
    const next = l.nextLifeAt ? `  ·  ${formatTime((l.nextLifeAt - Date.now()) / 1000)}` : '';
    // жизни восстанавливаются, пока открыта карта
    const regen = l.nextLifeAt && Date.now() >= l.nextLifeAt ? 1 : 0;
    this.livesText.setText(`${t.lives(Math.min(l.max, l.lives + regen), l.max)}${regen ? '' : next}`);
  }

  private levelAt(x: number, y: number): number | null {
    const r = 30 * this.data_.dpr;
    for (let id = 1; id <= this.data_.levelCount; id++) {
      const n = this.geo.node(id);
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return id;
    }
    return null;
  }

  private tapLevel(id: number): void {
    if (id > this.data_.maxLevel) {
      telegram.haptic('error');
      return;
    }
    telegram.haptic('tap');
    this.data_.onPlay(id);
  }

  /** Центр узла на экране (пиксели canvas) — для e2e. */
  nodeOnScreen(id: number): { x: number; y: number } {
    const n = this.geo.node(id);
    return { x: n.x, y: n.y - this.cameras.main.scrollY };
  }

  /** Прокрутить карту так, чтобы узел был на экране — для e2e. */
  scrollTo(id: number): void {
    this.cameras.main.setScroll(0, this.geo.node(id).y - this.scale.height * 0.6);
  }
}
