import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { artFiles, cardKey, districtKey } from '../src/art.ts';
import { PIECE_TONES, svgTextures } from '../src/svgArt.ts';

test('every art file exists in public/', () => {
  for (const f of artFiles()) assert.ok(existsSync(new URL(`../public/${f.url}`, import.meta.url)), f.url);
});

test('districts cycle through 14 backgrounds', () => {
  assert.equal(districtKey(1), 'district-1');
  assert.equal(districtKey(14), 'district-14');
  assert.equal(districtKey(15), 'district-1');
});

test('every card has art: its own or a fallback that is loaded', () => {
  const keys = new Set(artFiles().map((f) => f.key));
  const ids = ['mika_yukata', 'pon_lantern', 'ren_festival', 'setsu_moon', 'mika_sakura', 'ren_market', 'setsu_snow',
    'temple_fox', 'street_cat', 'port_crane', 'winter_owl', 'bridge_dragon', 'fountain_koi', 'bamboo_panda', 'mika_kimono',
    'hanami_mika', 'tanabata_ren', 'halloween_pon', 'newyear_setsu'];
  for (const id of ids) assert.ok(keys.has(cardKey(id) ?? ''), id);
  assert.equal(cardKey('unknown'), null);
});

test('svg covers every piece texture and is well-formed', () => {
  const all = svgTextures();
  for (let c = 0; c < PIECE_TONES.length; c++) {
    for (const s of ['none', 'lineH', 'lineV', 'bomb']) assert.ok(all[`p${c}-${s}`], `p${c}-${s}`);
  }
  for (const k of ['rainbow', 'lantern', 'cell', 'jelly1', 'ice2', 'chest1', 'daifuku2', 'fog', 'vines', 'b-hammer', 'crystal', 'star']) assert.ok(all[k], k);
  for (const [k, s] of Object.entries(all)) {
    assert.match(s, /^<svg [^>]*>.*<\/svg>$/s, k);
    assert.doesNotMatch(s, /NaN|undefined/, k);
  }
});
