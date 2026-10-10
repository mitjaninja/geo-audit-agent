import Phaser from 'phaser';

/**
 * Временная графика: всё рисуется кодом в текстуры при загрузке, файлов арта нет.
 * Ключи текстур — контракт для сцены; когда появится арт, достаточно загрузить
 * картинки под теми же ключами.
 */
export const TEX = 96;
const C = TEX / 2;

/** Пастельная палитра фишек: звезда, сердце, луна, лепесток, капля, лист. */
export const PIECE_COLORS = [0xffc93c, 0xff6fa8, 0xa78bfa, 0xff9466, 0x4fb8f5, 0x4fd39a] as const;

export const pieceKey = (color: number | null, special: string): string =>
  special === 'rainbow' ? 'rainbow' : special === 'lantern' ? 'lantern' : `p${color}-${special}`;

type Pt = { x: number; y: number };
const P = (x: number, y: number): Pt => ({ x, y });

function star(r: number, inner: number, n = 5): Pt[] {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 === 0 ? r : inner;
    return P(C + Math.cos(a) * rr, C + Math.sin(a) * rr);
  });
}

function heart(r: number): Pt[] {
  return Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    return P(C + (x / 17) * r, C + (y / 17) * r + 2);
  });
}

function moon(r: number): Pt[] {
  // серп: внешняя дуга круга r и внутренняя дуга смещённого круга
  const outer = Array.from({ length: 25 }, (_, i) => {
    const a = Math.PI * 0.35 + (i / 24) * Math.PI * 1.3;
    return P(C + Math.cos(a) * r, C + Math.sin(a) * r);
  });
  const inner = Array.from({ length: 25 }, (_, i) => {
    const a = Math.PI * 1.55 - (i / 24) * Math.PI * 1.1;
    return P(C + r * 0.45 + Math.cos(a) * r * 0.8, C - r * 0.1 + Math.sin(a) * r * 0.8);
  });
  return [...outer, ...inner];
}

function petal(r: number): Pt[] {
  // лепесток сакуры: капля с выемкой наверху
  return Array.from({ length: 49 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const notch = 1 - 0.28 * Math.exp(-((Math.atan2(Math.sin(t), Math.cos(t)) + Math.PI / 2) ** 2) * 12);
    const rr = r * (0.72 + 0.28 * Math.sin(t)) * notch;
    return P(C + Math.cos(t) * rr * 0.85, C + 4 + Math.sin(t) * rr);
  });
}

function drop(r: number): Pt[] {
  return Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const x = Math.sin(t) * (1 - Math.cos(t)) * 0.5;
    const y = -Math.cos(t);
    return P(C + x * r * 1.25, C + 6 + y * r);
  });
}

function leaf(r: number): Pt[] {
  return Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const x = Math.sin(t) * Math.abs(Math.sin(t)) ** 0.2 * 0.55;
    const y = Math.cos(t);
    // наклон листа на 35°
    const a = Math.PI / 5;
    return P(C + (x * Math.cos(a) - y * Math.sin(a)) * r, C + (x * Math.sin(a) + y * Math.cos(a)) * r);
  });
}

const SHAPES: ((r: number) => Pt[])[] = [(r) => star(r, r * 0.48), heart, moon, petal, drop, leaf];

function crystal(g: Phaser.GameObjects.Graphics, color: number, shape: number): void {
  g.fillStyle(color, 0.22);
  g.fillCircle(C, C, 44);
  const pts = SHAPES[shape]!(34);
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
  g.lineStyle(3, 0xffffff, 0.75);
  g.strokePoints(pts, true);
  g.fillStyle(0xffffff, 0.55);
  g.fillEllipse(C - 10, C - 12, 14, 9);
}

function overlay(g: Phaser.GameObjects.Graphics, special: string): void {
  if (special === 'lineH' || special === 'lineV') {
    g.fillStyle(0xffffff, 0.9);
    for (const d of [-12, 0, 12]) {
      if (special === 'lineH') g.fillRect(C - 30, C + d - 2, 60, 4);
      else g.fillRect(C + d - 2, C - 30, 4, 60);
    }
  } else if (special === 'bomb') {
    g.lineStyle(7, 0x3b2a4a, 0.85);
    g.strokeCircle(C, C, 30);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(C + 22, C - 24, 6);
  }
}

function draw(scene: Phaser.Scene, key: string, paint: (g: Phaser.GameObjects.Graphics) => void): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  paint(g);
  g.generateTexture(key, TEX, TEX);
  g.destroy();
}

export function makeTextures(scene: Phaser.Scene): void {
  PIECE_COLORS.forEach((color, i) => {
    for (const special of ['none', 'lineH', 'lineV', 'bomb']) {
      draw(scene, pieceKey(i, special), (g) => {
        crystal(g, color, i);
        overlay(g, special);
      });
    }
  });

  draw(scene, 'rainbow', (g) => {
    PIECE_COLORS.forEach((c, i) => {
      g.fillStyle(c, 1);
      g.slice(C, C, 36, Phaser.Math.DegToRad(i * 60), Phaser.Math.DegToRad(i * 60 + 60), false);
      g.fillPath();
    });
    g.fillStyle(0xffffff, 1);
    g.fillPoints(star(18, 8), true);
  });

  draw(scene, 'lantern', (g) => {
    g.fillStyle(0xffd27a, 0.35);
    g.fillCircle(C, C, 42);
    g.fillStyle(0xe8453c, 1);
    g.fillEllipse(C, C, 50, 58);
    g.lineStyle(2, 0xffb347, 0.9);
    for (const d of [-14, 0, 14]) g.strokeEllipse(C, C, 50 - Math.abs(d) * 1.5, 58);
    g.fillStyle(0x3b2a4a, 1);
    g.fillRect(C - 14, C - 34, 28, 7);
    g.fillRect(C - 14, C + 27, 28, 7);
  });

  draw(scene, 'cell', (g) => {
    g.fillStyle(0xffffff, 0.55);
    g.fillRoundedRect(3, 3, TEX - 6, TEX - 6, 14);
  });
  draw(scene, 'select', (g) => {
    g.lineStyle(6, 0xffffff, 1);
    g.strokeRoundedRect(5, 5, TEX - 10, TEX - 10, 16);
  });
  for (const layers of [1, 2]) {
    draw(scene, `jelly${layers}`, (g) => {
      g.fillStyle(0xff8fc8, layers === 2 ? 0.75 : 0.45);
      g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 14);
    });
    draw(scene, `ice${layers}`, (g) => {
      g.fillStyle(0xbfe8ff, 0.9);
      g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 12);
      g.lineStyle(layers === 2 ? 8 : 3, 0xffffff, 0.95);
      g.strokeRoundedRect(8, 8, TEX - 16, TEX - 16, 10);
      g.lineStyle(3, 0xffffff, 0.8);
      g.lineBetween(24, 30, 44, 50);
      g.lineBetween(52, 24, 70, 44);
    });
    draw(scene, `chest${layers}`, (g) => {
      g.fillStyle(0x9c6a3c, 1);
      g.fillRoundedRect(12, 22, TEX - 24, TEX - 36, 8);
      g.fillStyle(0x7a4f2a, 1);
      g.fillRect(12, 40, TEX - 24, 6);
      g.fillStyle(0xffd166, 1);
      for (let i = 0; i < layers; i++) g.fillRoundedRect(C - 9 + (layers === 2 ? (i ? 12 : -12) : 0), 46, 18, 20, 4);
    });
    draw(scene, `daifuku${layers}`, (g) => {
      g.fillStyle(0x6b4226, 1);
      g.fillEllipse(C, C + 6, 72, 58);
      g.fillStyle(layers === 2 ? 0xf6d6e4 : 0x8a5a3a, 1);
      g.fillEllipse(C, C - 2, 56, 40);
      g.fillStyle(0xffffff, 0.4);
      g.fillEllipse(C - 12, C - 10, 14, 8);
    });
  }
  draw(scene, 'fog', (g) => {
    const puffs = [[30, 52, 22], [52, 40, 26], [70, 58, 20], [48, 64, 22]] as const;
    // светлый контур — чтобы туман читался и на тёмной теме
    g.fillStyle(0xd8b4ff, 0.9);
    for (const [x, y, r] of puffs) g.fillCircle(x, y, r + 3);
    g.fillStyle(0x4b2f6b, 1);
    for (const [x, y, r] of puffs) g.fillCircle(x, y, r);
    g.fillStyle(0xd8b4ff, 1);
    g.fillCircle(40, 50, 4);
    g.fillCircle(58, 50, 4);
  });
  draw(scene, 'vines', (g) => {
    g.lineStyle(6, 0x8e6bd8, 0.9);
    g.lineBetween(10, 20, 86, 76);
    g.lineBetween(10, 76, 86, 20);
    g.fillStyle(0x6fcf7f, 1);
    for (const [x, y] of [[24, 30], [72, 30], [24, 66], [72, 66]] as const) g.fillEllipse(x, y, 14, 8);
  });
  // белая — под tint: золотая полученная звезда, серая неполученная
  draw(scene, 'star', (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints(star(44, 20), true);
  });
  // иконки бустеров и кристалла (временная графика)
  const disc = (g: Phaser.GameObjects.Graphics, color: number) => {
    g.fillStyle(color, 1);
    g.fillCircle(C, C, 44);
    g.fillStyle(0xffffff, 0.25);
    g.fillEllipse(C - 12, C - 18, 40, 22);
  };
  draw(scene, 'b-hammer', (g) => {
    disc(g, 0xffd6a5);
    g.fillStyle(0x9c6a3c, 1);
    g.fillPoints([P(30, 72), P(38, 80), P(66, 46), P(58, 38)], true);
    g.fillStyle(0x6b6f80, 1);
    g.fillPoints([P(46, 26), P(70, 50), P(80, 40), P(56, 16)], true);
  });
  draw(scene, 'b-freeSwap', (g) => {
    disc(g, 0xc8f0dc);
    g.fillStyle(0x2fa36b, 1);
    g.fillPoints([P(18, 38), P(36, 22), P(36, 32), P(62, 32), P(62, 44), P(36, 44), P(36, 54)], true);
    g.fillPoints([P(78, 58), P(60, 74), P(60, 64), P(34, 64), P(34, 52), P(60, 52), P(60, 42)], true);
  });
  draw(scene, 'b-shuffle', (g) => {
    disc(g, 0xd9ccff);
    g.lineStyle(9, 0x7b5cd6, 1);
    g.beginPath();
    g.arc(C, C, 24, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false);
    g.strokePath();
    g.beginPath();
    g.arc(C, C, 24, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160), false);
    g.strokePath();
    g.fillStyle(0x7b5cd6, 1);
    g.fillPoints([P(68, 30), P(80, 46), P(62, 46)], true);
    g.fillPoints([P(28, 66), P(16, 50), P(34, 50)], true);
  });
  draw(scene, 'b-beamBomb', (g) => {
    disc(g, 0xfff0b3);
    g.fillStyle(0xffffff, 1);
    for (const d of [-10, 0, 10]) g.fillRect(14, C + d - 2, 68, 4);
    g.lineStyle(7, 0x3b2a4a, 0.9);
    g.strokeCircle(C + 8, C + 6, 18);
  });
  draw(scene, 'b-rainbow', (g) => {
    PIECE_COLORS.forEach((c, i) => {
      g.fillStyle(c, 1);
      g.slice(C, C, 44, Phaser.Math.DegToRad(i * 60), Phaser.Math.DegToRad(i * 60 + 60), false);
      g.fillPath();
    });
    g.fillStyle(0xffffff, 1);
    g.fillPoints(star(20, 9), true);
  });
  draw(scene, 'b-extraMoves', (g) => {
    disc(g, 0xffc2d9);
    g.fillStyle(0xffffff, 1);
    g.fillRect(C - 26, C - 5, 30, 10);
    g.fillRect(C - 16, C - 15, 10, 30);
    for (const dy of [-16, 0, 16]) g.fillCircle(C + 20, C + dy, 6);
  });
  draw(scene, 'crystal', (g) => {
    const pts = [P(C, 10), P(C + 34, C - 6), P(C, TEX - 10), P(C - 34, C - 6)];
    g.fillStyle(0x7fd6ff, 1);
    g.fillPoints(pts, true);
    g.fillStyle(0xc9f0ff, 1);
    g.fillPoints([P(C, 10), P(C + 34, C - 6), P(C, C - 6), P(C - 34, C - 6)], true);
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokePoints(pts, true);
  });

  // маркер касания для обучения и подсказок: «палец» тянет фишку
  draw(scene, 'hand', (g) => {
    g.fillStyle(0x3b2a4a, 0.18);
    g.fillCircle(C + 3, C + 4, 34);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(C, C, 32);
    g.lineStyle(7, 0xff6fa8, 1);
    g.strokeCircle(C, C, 30);
    g.fillStyle(0xff6fa8, 1);
    g.fillCircle(C, C, 9);
  });
  draw(scene, 'spark', (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints(star(20, 6, 4), true);
  });
  draw(scene, 'beam', (g) => {
    g.fillStyle(0xfff3b0, 1);
    g.fillRect(0, C - 10, TEX, 20);
  });
}
