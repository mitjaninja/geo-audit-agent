import assert from 'node:assert/strict';
import { test } from 'node:test';
import { episodeLit, episodeOf, episodes, mapGeometry, nodeState, starsInEpisode } from '../src/map.ts';

test('episodes of 15 levels named after Hoshiro districts', () => {
  const e = episodes(30);
  assert.deepEqual(e.map((x) => [x.id, x.name, x.from, x.to]), [[1, 'Храмовый холм', 1, 15], [2, 'Торговая улица', 16, 30]]);
  assert.equal(episodes(31).length, 3);
  assert.equal(episodes(31)[2]!.to, 31, 'the last episode may be partial');
  assert.equal(episodes(80)[5]!.name, 'Сад фонтанов');
  assert.equal(episodes(220)[14]!.name, 'Храмовый холм 2', 'names repeat after the 14 districts');
  assert.equal(episodeOf(15), 1);
  assert.equal(episodeOf(16), 2);
});

test('node states and lit districts', () => {
  assert.equal(nodeState(3, 5, 2), 'done');
  assert.equal(nodeState(5, 5, 0), 'current');
  assert.equal(nodeState(6, 5, 0), 'locked');
  const [first] = episodes(30);
  assert.equal(episodeLit(first!, 15), false);
  assert.equal(episodeLit(first!, 16), true);
  assert.equal(starsInEpisode(first!, { 1: { stars: 3 }, 2: { stars: 1 }, 16: { stars: 3 } }), 4);
});

test('geometry: level 1 at the bottom, path goes up, nodes stay on screen, bands contain their nodes', () => {
  const g = mapGeometry(30, 390);
  for (let id = 1; id < 30; id++) assert.ok(g.node(id + 1).y < g.node(id).y, `level ${id + 1} above ${id}`);
  for (let id = 1; id <= 30; id++) {
    const { x, y } = g.node(id);
    assert.ok(x > 40 && x < 350 && y > 0 && y < g.height);
  }
  for (const e of episodes(30)) {
    const b = g.band(e);
    for (let id = e.from; id <= e.to; id++) assert.ok(g.node(id).y > b.top && g.node(id).y < b.bottom);
  }
  // между районами — место под заголовок
  assert.ok(g.node(15).y - g.node(16).y > g.spacing);
});
