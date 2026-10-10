import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankLevel, cell, check, paint, portals, portalTap, resize } from '../src/editor/model.ts';

test('editor: paint layers; a hole clears jelly, blockers and portals; empty layers are dropped', () => {
  let raw = blankLevel(50, 6, 6);
  raw = paint(raw, 'jelly', 5, 0, '1');
  raw = paint(raw, 'blockers', 4, 1, 'I');
  assert.equal(cell(raw, 'jelly', 5, 0), '1');
  assert.equal((raw.blockers as string[])[4], '.I....');
  raw = paint(raw, 'shape', 4, 1, '_');
  assert.equal(cell(raw, 'shape', 4, 1), '_');
  assert.equal(raw.blockers, undefined, 'only blocker was on the hole');
  assert.equal(cell(raw, 'jelly', 4, 1), '_');
  assert.equal(paint(raw, 'blockers', 4, 1, 'f'), raw, 'no blockers on holes');
  raw = paint(raw, 'jelly', 5, 0, '0');
  raw = paint(raw, 'shape', 4, 1, '#');
  assert.equal(raw.jelly, undefined);
  assert.equal(raw.shape, undefined);
});

test('editor: portals by two taps, removed by tapping an end; resize trims grids and portals', () => {
  let raw = blankLevel(51, 6, 6);
  let s = portalTap(raw, null, 1, 1);
  assert.deepEqual(s.pending, [1, 1]);
  s = portalTap(s.raw, s.pending, 4, 4);
  raw = s.raw;
  assert.deepEqual(portals(raw), [{ from: [1, 1], to: [4, 4] }]);
  assert.equal(portalTap(raw, null, 4, 4).raw.portals, undefined);
  raw = paint(raw, 'blockers', 5, 5, 'i');
  raw = resize(raw, 4, 4);
  assert.equal(raw.portals, undefined, 'portal end outside');
  assert.equal(raw.blockers, undefined, 'the only blocker was cut off');
  raw = paint(raw, 'jelly', 0, 0, '2');
  assert.deepEqual(resize(raw, 7, 5).jelly, ['2000000', '0000000', '0000000', '0000000', '0000000']);
});

test('editor: check reports core errors and lint warnings', () => {
  const ok = check(blankLevel(52));
  assert.ok(ok.level);
  assert.deepEqual(ok.errors, []);
  const bad = check({ ...blankLevel(53), goals: [{ type: 'jelly' }] });
  assert.equal(bad.level, null);
  assert.match(bad.errors.join(), /jelly/);
  const warn = check({ ...blankLevel(54, 5, 5), portals: [{ from: [1, 0], to: [3, 4] }] });
  assert.match(warn.warnings[0]!, /out of nowhere/);
});
