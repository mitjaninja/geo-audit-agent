/**
 * Векторная графика поля: фишки-кристаллы, спецфишки, блокеры, иконки бустеров.
 * Чистый модуль без Phaser — строки SVG (viewBox 96×96) по ключам текстур из textures.ts.
 * Сцена растеризует их при загрузке; нарисованные кодом текстуры остаются запасными.
 */
export const VIEW = 96;
const C = VIEW / 2;

/** Кристаллы: [основной, светлый, тёмный] — звезда, сердце, луна, лепесток, капля, лист. */
export const PIECE_TONES = [
  ['#ffc93c', '#fff3b8', '#e08a00'],
  ['#ff6fa8', '#ffd3e6', '#d1336f'],
  ['#a78bfa', '#e6dcff', '#6a4fd0'],
  ['#ff9466', '#ffe0cf', '#d9552a'],
  ['#4fb8f5', '#d4efff', '#1a7cc0'],
  ['#4fd39a', '#d2f7e5', '#1d9a63'],
] as const;

type Pt = readonly [number, number];
const r1 = (n: number) => Math.round(n * 10) / 10;
const path = (pts: readonly Pt[]) => `M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;

function star(r: number, inner: number, n = 5, cx = C, cy = C): Pt[] {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 === 0 ? r : inner;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
  });
}

function heart(r: number): Pt[] {
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    return [C + (x / 17) * r, C + (y / 17) * r + 2] as const;
  });
}

function moon(r: number): Pt[] {
  const outer = Array.from({ length: 33 }, (_, i) => {
    const a = Math.PI * 0.35 + (i / 32) * Math.PI * 1.3;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  });
  const inner = Array.from({ length: 33 }, (_, i) => {
    const a = Math.PI * 1.55 - (i / 32) * Math.PI * 1.1;
    return [C + r * 0.45 + Math.cos(a) * r * 0.8, C - r * 0.1 + Math.sin(a) * r * 0.8] as const;
  });
  return [...outer, ...inner];
}

function petal(r: number): Pt[] {
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    const notch = 1 - 0.28 * Math.exp(-((Math.atan2(Math.sin(t), Math.cos(t)) + Math.PI / 2) ** 2) * 12);
    const rr = r * (0.72 + 0.28 * Math.sin(t)) * notch;
    return [C + Math.cos(t) * rr * 0.85, C + 4 + Math.sin(t) * rr] as const;
  });
}

function drop(r: number): Pt[] {
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    return [C + Math.sin(t) * (1 - Math.cos(t)) * 0.5 * r * 1.25, C + 6 - Math.cos(t) * r] as const;
  });
}

function leaf(r: number): Pt[] {
  const a = Math.PI / 5;
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    const x = Math.sin(t) * Math.abs(Math.sin(t)) ** 0.2 * 0.55;
    const y = Math.cos(t);
    return [C + (x * Math.cos(a) - y * Math.sin(a)) * r, C + (x * Math.sin(a) + y * Math.cos(a)) * r] as const;
  });
}

const SHAPES: readonly ((r: number) => Pt[])[] = [(r) => star(r, r * 0.5), heart, moon, petal, drop, leaf];

const svg = (body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">` +
  (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>';

/** Глянцевый кристалл-конфета: свечение, объёмная заливка, блик. */
function crystal(color: number, extra = ''): string {
  const [base, light, dark] = PIECE_TONES[color]!;
  const d = path(SHAPES[color]!(35));
  const defs =
    `<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${light}"/><stop offset=".45" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient>` +
    `<radialGradient id="h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${base}" stop-opacity=".45"/><stop offset="1" stop-color="${base}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="c"><path d="${d}"/></clipPath>`;
  return svg(
    `<circle cx="${C}" cy="${C}" r="47" fill="url(#h)"/>` +
    `<path d="${d}" fill="url(#g)" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>` +
    // грань: светлая половина сверху-слева придаёт огранку
    `<g clip-path="url(#c)"><path d="M0 0H96L0 70Z" fill="#fff" opacity=".16"/></g>` +
    `<path d="${d}" fill="none" stroke="#fff" stroke-width="1.6" stroke-opacity=".7" stroke-linejoin="round" transform="translate(${C} ${C}) scale(.86) translate(${-C} ${-C})"/>` +
    `<ellipse cx="36" cy="34" rx="9" ry="5.5" fill="#fff" opacity=".85" transform="rotate(-28 36 34)"/>` +
    `<circle cx="47" cy="29" r="2.4" fill="#fff" opacity=".8"/>` + extra,
    defs,
  );
}

/** Луч фонаря: светящиеся полосы со стрелками по направлению. */
function lineOverlay(vertical: boolean): string {
  const g = `<g${vertical ? ` transform="rotate(90 ${C} ${C})"` : ''}>` +
    `<rect x="12" y="${C - 7}" width="72" height="14" rx="7" fill="#fff" opacity=".35"/>` +
    `<rect x="16" y="${C - 3}" width="64" height="6" rx="3" fill="#fff"/>` +
    `<path d="M6 ${C}l10 -9v18zM90 ${C}l-10 -9v18z" fill="#fff" stroke="#3b2a4a" stroke-width="1.5" stroke-opacity=".35"/>` +
    '</g>';
  return g;
}

/** Бумажная бомба: тёмное кольцо-оплётка и искра фитиля. */
const bombOverlay =
  `<circle cx="${C}" cy="${C + 2}" r="29" fill="none" stroke="#3b2a4a" stroke-width="6" stroke-opacity=".8" stroke-dasharray="10 5"/>` +
  `<path d="M66 26q6 -8 12 -6" fill="none" stroke="#3b2a4a" stroke-width="3" stroke-linecap="round"/>` +
  `<path d="${path(star(9, 3.5, 4, 79, 19))}" fill="#fff6b0" stroke="#ff9466" stroke-width="1.5"/>`;

const rainbow = () => {
  const colors = PIECE_TONES.map((t) => t[0]);
  const slices = colors.map((c, i) => {
    const a0 = (i * Math.PI) / 3 - Math.PI / 2;
    const a1 = a0 + Math.PI / 3;
    const p = (a: number) => `${r1(C + Math.cos(a) * 38)} ${r1(C + Math.sin(a) * 38)}`;
    return `<path d="M${C} ${C}L${p(a0)}A38 38 0 0 1 ${p(a1)}Z" fill="${c}"/>`;
  }).join('');
  return svg(
    `<circle cx="${C}" cy="${C}" r="47" fill="url(#h)"/>${slices}` +
    `<circle cx="${C}" cy="${C}" r="38" fill="url(#s)" stroke="#fff" stroke-width="3"/>` +
    `<path d="${path(star(19, 8))}" fill="#fff" stroke="#ffc93c" stroke-width="2" stroke-linejoin="round"/>` +
    '<ellipse cx="34" cy="28" rx="8" ry="4.5" fill="#fff" opacity=".7" transform="rotate(-30 34 28)"/>',
    '<radialGradient id="h"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="s" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#3b2a4a" stop-opacity=".25"/></radialGradient>',
  );
};

const lantern = () => svg(
  `<circle cx="${C}" cy="${C}" r="46" fill="url(#h)"/>` +
  `<rect x="${C - 15}" y="12" width="30" height="8" rx="2.5" fill="#3b2a4a"/>` +
  `<rect x="${C - 15}" y="76" width="30" height="8" rx="2.5" fill="#3b2a4a"/>` +
  `<ellipse cx="${C}" cy="${C}" rx="27" ry="30" fill="url(#g)" stroke="#a8231c" stroke-width="2.5"/>` +
  [-16, -6, 6, 16].map((dx) => `<path d="M${C + dx * 0.4} 19Q${C + dx * 1.55} ${C} ${C + dx * 0.4} 77" fill="none" stroke="#ffb347" stroke-width="1.6" opacity=".8"/>`).join('') +
  `<path d="${path(petalSmall())}" fill="#fff" opacity=".9"/>` +
  `<ellipse cx="38" cy="34" rx="6" ry="9" fill="#fff" opacity=".35" transform="rotate(20 38 34)"/>` +
  `<path d="M${C} 84v6" stroke="#ffb347" stroke-width="3" stroke-linecap="round"/>`,
  '<radialGradient id="h"><stop offset="0" stop-color="#ffd27a" stop-opacity=".8"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="g" cx="45%" cy="45%" r="65%"><stop offset="0" stop-color="#ffcf7a"/><stop offset=".55" stop-color="#ff5a45"/><stop offset="1" stop-color="#c22a20"/></radialGradient>',
);

function petalSmall(): Pt[] {
  return Array.from({ length: 40 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    const rr = 9 * (0.75 + 0.25 * Math.sin(5 * t));
    return [C + Math.cos(t) * rr, C + Math.sin(t) * rr] as const;
  });
}

// ---------- клетки и блокеры ----------

const cell = () => svg(
  '<rect x="3" y="3" width="90" height="90" rx="16" fill="#fff" fill-opacity=".5"/>' +
  '<rect x="3.5" y="3.5" width="89" height="89" rx="15.5" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>',
);

const jelly = (layers: number) => svg(
  `<rect x="4" y="4" width="88" height="88" rx="18" fill="url(#j)" stroke="#ff5fae" stroke-opacity="${layers === 2 ? 0.9 : 0.5}" stroke-width="3"/>` +
  '<ellipse cx="30" cy="22" rx="14" ry="6" fill="#fff" opacity=".55"/>' +
  (layers === 2 ? '<circle cx="74" cy="72" r="5" fill="#fff" opacity=".5"/><circle cx="64" cy="80" r="3" fill="#fff" opacity=".5"/>' : ''),
  `<linearGradient id="j" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3dc" stop-opacity="${layers === 2 ? 0.85 : 0.5}"/><stop offset="1" stop-color="#ff7ac0" stop-opacity="${layers === 2 ? 0.85 : 0.5}"/></linearGradient>`,
);

const ice = (layers: number) => svg(
  `<rect x="4" y="4" width="88" height="88" rx="14" fill="url(#i)" stroke="#fff" stroke-width="${layers === 2 ? 6 : 3}"/>` +
  '<path d="M18 26l20 20M60 18l16 18M24 70l14 -12M58 74l18 -12" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>' +
  '<path d="M10 40L40 10H58L10 58Z" fill="#fff" opacity=".35"/>' +
  (layers === 2 ? '<rect x="13" y="13" width="70" height="70" rx="9" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2" stroke-dasharray="6 5"/>' : ''),
  '<linearGradient id="i" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6f7ff" stop-opacity=".95"/><stop offset="1" stop-color="#8fd3ff" stop-opacity=".92"/></linearGradient>',
);

const chest = (layers: number) => svg(
  '<rect x="12" y="34" width="72" height="46" rx="7" fill="#a8703d" stroke="#5e3a1c" stroke-width="3"/>' +
  '<path d="M12 40Q12 18 48 18Q84 18 84 40V46H12Z" fill="#c4874c" stroke="#5e3a1c" stroke-width="3"/>' +
  '<rect x="12" y="44" width="72" height="7" fill="#5e3a1c"/>' +
  '<path d="M22 22V80M74 22V80" stroke="#ffd166" stroke-width="4"/>' +
  (layers === 2
    ? '<rect x="30" y="50" width="14" height="18" rx="3" fill="#ffd166" stroke="#5e3a1c" stroke-width="2"/><rect x="52" y="50" width="14" height="18" rx="3" fill="#ffd166" stroke="#5e3a1c" stroke-width="2"/>'
    : '<rect x="40" y="48" width="16" height="20" rx="3" fill="#ffd166" stroke="#5e3a1c" stroke-width="2"/><circle cx="48" cy="57" r="2.5" fill="#5e3a1c"/>') +
  '<ellipse cx="34" cy="26" rx="10" ry="3" fill="#fff" opacity=".35"/>',
);

const daifuku = (layers: number) => svg(
  '<ellipse cx="48" cy="80" rx="32" ry="6" fill="#3b2a4a" opacity=".18"/>' +
  `<path d="M14 64Q12 26 48 22Q84 26 82 64Q80 80 48 80Q16 80 14 64Z" fill="url(#d)" stroke="#c8a2b4" stroke-width="2.5"/>` +
  (layers === 2
    ? '<path d="M30 30Q48 18 66 30" fill="none" stroke="#9fd39a" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="24" r="5" fill="#ff8fb4"/>'
    : '<path d="M34 56Q48 44 62 56Q60 66 48 66Q36 66 34 56Z" fill="#7a3f4a" opacity=".55"/>') +
  '<circle cx="38" cy="54" r="2.5" fill="#3b2a4a"/><circle cx="58" cy="54" r="2.5" fill="#3b2a4a"/>' +
  '<path d="M44 60q4 4 8 0" fill="none" stroke="#3b2a4a" stroke-width="2" stroke-linecap="round"/>' +
  '<ellipse cx="30" cy="40" rx="8" ry="5" fill="#fff" opacity=".8" transform="rotate(-25 30 40)"/>',
  `<radialGradient id="d" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${layers === 2 ? '#f6c6da' : '#ead8e0'}"/></radialGradient>`,
);

const fog = () => {
  const puffs = [[28, 54, 20], [48, 40, 25], [70, 54, 19], [48, 64, 22], [36, 66, 15], [62, 68, 15]] as const;
  return svg(
    puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="#d8b4ff"/>`).join('') +
    puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#f)"/>`).join('') +
    '<ellipse cx="39" cy="50" rx="4.5" ry="5.5" fill="#ffe27a"/><ellipse cx="58" cy="50" rx="4.5" ry="5.5" fill="#ffe27a"/>' +
    '<circle cx="40" cy="49" r="1.6" fill="#3b2a4a"/><circle cx="59" cy="49" r="1.6" fill="#3b2a4a"/>' +
    '<path d="M42 62q6 4 12 0" fill="none" stroke="#d8b4ff" stroke-width="2.5" stroke-linecap="round"/>',
    '<radialGradient id="f" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#7a52a8"/><stop offset="1" stop-color="#3a2156"/></radialGradient>',
  );
};

const vines = () => svg(
  '<path d="M8 18Q30 40 48 48T88 78M8 78Q30 56 48 48T88 18" fill="none" stroke="#5a3f9a" stroke-width="9" stroke-linecap="round" opacity=".9"/>' +
  '<path d="M8 18Q30 40 48 48T88 78M8 78Q30 56 48 48T88 18" fill="none" stroke="#9b7bff" stroke-width="5" stroke-linecap="round"/>' +
  [[24, 30, 30], [72, 30, -30], [24, 66, -30], [72, 66, 30], [48, 36, 0]].map(([x, y, a]) =>
    `<ellipse cx="${x}" cy="${y}" rx="9" ry="5" fill="#6fcf7f" stroke="#2f8a4a" stroke-width="1.5" transform="rotate(${a} ${x} ${y})"/>`).join(''),
);

// ---------- иконки ----------

/** Кружок-подложка иконки бустера с бликом. */
const disc = (fill: string, ring: string, body: string) => svg(
  `<circle cx="${C}" cy="${C}" r="44" fill="${fill}" stroke="${ring}" stroke-width="4"/>` +
  `<ellipse cx="${C - 10}" cy="${C - 22}" rx="22" ry="10" fill="#fff" opacity=".4"/>` + body,
);

const icons: Record<string, () => string> = {
  'b-hammer': () => disc('#ffe3c2', '#e8a35c',
    '<rect x="44" y="34" width="10" height="46" rx="4" fill="#a8703d" stroke="#5e3a1c" stroke-width="2.5" transform="rotate(40 48 56)"/>' +
    '<rect x="30" y="18" width="40" height="22" rx="6" fill="#ff8fb4" stroke="#b03a6a" stroke-width="2.5" transform="rotate(40 50 30)"/>' +
    '<rect x="34" y="22" width="12" height="6" rx="3" fill="#fff" opacity=".6" transform="rotate(40 50 30)"/>'),
  'b-freeSwap': () => disc('#d2f7e5', '#4fd39a',
    '<path d="M20 38h44l-10 -10M76 58H32l10 10" fill="none" stroke="#1d9a63" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'),
  'b-shuffle': () => disc('#e6dcff', '#a78bfa',
    '<path d="M70 40A24 24 0 0 0 28 34M26 56A24 24 0 0 0 68 62" fill="none" stroke="#6a4fd0" stroke-width="8" stroke-linecap="round"/>' +
    '<path d="M74 26L74 44L58 42Z" fill="#6a4fd0" stroke="#6a4fd0" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M22 70L22 52L38 54Z" fill="#6a4fd0" stroke="#6a4fd0" stroke-width="3" stroke-linejoin="round"/>'),
  'b-beamBomb': () => disc('#fff3c4', '#ffc93c',
    '<rect x="12" y="24" width="72" height="8" rx="4" fill="#fff" stroke="#e0a800" stroke-width="2"/>' +
    `<circle cx="48" cy="60" r="20" fill="#ff6fa8" stroke="#3b2a4a" stroke-width="4" stroke-dasharray="8 4"/>` +
    '<path d="M62 44q4 -6 9 -5" fill="none" stroke="#3b2a4a" stroke-width="3" stroke-linecap="round"/>' +
    `<path d="${path(star(7, 2.8, 4, 73, 38))}" fill="#fff6b0" stroke="#ff9466" stroke-width="1.5"/>`),
  'b-rainbow': rainbow,
  'b-extraMoves': () => disc('#ffd3e6', '#ff6fa8',
    '<path d="M24 48h22M35 37v22" stroke="#d1336f" stroke-width="8" stroke-linecap="round"/>' +
    '<text x="64" y="62" font-family="Arial Rounded MT Bold,Arial,sans-serif" font-size="34" font-weight="900" text-anchor="middle" fill="#d1336f">3</text>'),
  crystal: () => svg(
    `<circle cx="${C}" cy="${C}" r="46" fill="url(#h)"/>` +
    '<path d="M48 8L82 36L48 88L14 36Z" fill="url(#g)" stroke="#2a8fd0" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M14 36H82M32 36L48 8L64 36L48 88Z" fill="none" stroke="#fff" stroke-width="2" stroke-opacity=".8" stroke-linejoin="round"/>' +
    '<path d="M48 8L32 36H14Z" fill="#fff" opacity=".55"/>',
    '<radialGradient id="h"><stop offset="0" stop-color="#7fd6ff" stop-opacity=".55"/><stop offset="1" stop-color="#7fd6ff" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f4ff"/><stop offset=".5" stop-color="#7fd6ff"/><stop offset="1" stop-color="#3a9ee0"/></linearGradient>',
  ),
  // белая — под tint (золотая/серая звезда результата)
  star: () => svg(
    `<path d="${path(star(44, 21))}" fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${path(star(30, 14))}" fill="#000" opacity=".06"/>` +
    '<ellipse cx="36" cy="30" rx="7" ry="4" fill="#fff"/>',
  ),
};

/** Все SVG по ключам текстур. */
export function svgTextures(): Record<string, string> {
  const out: Record<string, string> = {};
  PIECE_TONES.forEach((_, i) => {
    out[`p${i}-none`] = crystal(i);
    out[`p${i}-lineH`] = crystal(i, lineOverlay(false));
    out[`p${i}-lineV`] = crystal(i, lineOverlay(true));
    out[`p${i}-bomb`] = crystal(i, bombOverlay);
  });
  out.rainbow = rainbow();
  out.lantern = lantern();
  out.cell = cell();
  for (const l of [1, 2]) {
    out[`jelly${l}`] = jelly(l);
    out[`ice${l}`] = ice(l);
    out[`chest${l}`] = chest(l);
    out[`daifuku${l}`] = daifuku(l);
  }
  out.fog = fog();
  out.vines = vines();
  for (const [k, f] of Object.entries(icons)) out[k] = f();
  return out;
}
