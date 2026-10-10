import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MetaView } from '../src/api.ts';
import { metaBadges, rewardIcon, rewardText, taskText, wheelOdds } from '../src/meta.ts';

const meta = (over: Partial<MetaView> = {}): MetaView => ({
  day: 1, nextDayAt: 0,
  login: { count: 1, claimedToday: true, position: 1, rewards: [] },
  tasks: [{ kind: 'win', target: 2, progress: 1, claimed: false, reward: { items: { hammer: 1 } } }],
  chests: [{ episode: 1, stars: 10, tiers: [{ tier: 30, reward: {}, claimed: false, available: false }] }],
  wheel: { free: false, extraLeft: 3, price: 9, prizes: [{ id: 'a', weight: 3, reward: { crystals: 3 } }, { id: 'b', weight: 1, reward: { items: { shuffle: 1 } } }] },
  cards: {}, stuck: null,
  ...over,
});

test('reward and task texts', () => {
  assert.equal(rewardText({ items: { hammer: 1, shuffle: 2 }, crystals: 2 }), 'Молот Пона, Перемешать ×2, 2 💎');
  assert.equal(rewardText({ infiniteLivesMs: 30 * 60_000, card: 'mika_yukata' }), '∞ жизни 30 мин, карточка «Мика в юкате»');
  assert.deepEqual(rewardIcon({ items: { rainbow: 1 } }), { texture: 'b-rainbow' });
  assert.deepEqual(rewardIcon({ card: 'x', items: { freeSwap: 1 } }), { text: '🎴' });
  assert.equal(taskText({ kind: 'win', target: 2, progress: 0, claimed: false, reward: {} }), 'Пройди 2 уровня');
  assert.equal(taskText({ kind: 'win', target: 5, progress: 0, claimed: false, reward: {} }), 'Пройди 5 уровней');
  assert.equal(taskText({ kind: 'stars', target: 4, progress: 0, claimed: false, reward: {} }), 'Собери 4 звезды');
  assert.equal(taskText({ kind: 'stars', target: 6, progress: 0, claimed: false, reward: {} }), 'Собери 6 звёзд');
});

test('badges: something to claim lights the button', () => {
  assert.deepEqual(metaBadges(meta()), { daily: false, wheel: false });
  assert.equal(metaBadges(meta({ login: { count: 1, claimedToday: false, position: 1, rewards: [] } })).daily, true);
  assert.equal(metaBadges(meta({ tasks: [{ kind: 'win', target: 2, progress: 2, claimed: false, reward: {} }] })).daily, true);
  assert.equal(metaBadges(meta({ tasks: [{ kind: 'win', target: 2, progress: 2, claimed: true, reward: {} }] })).daily, false);
  assert.equal(metaBadges(meta({ chests: [{ episode: 1, stars: 30, tiers: [{ tier: 30, reward: {}, claimed: false, available: true }] }] })).daily, true);
  assert.equal(metaBadges(meta({ wheel: { ...meta().wheel, free: true } })).wheel, true);
});

test('wheel odds are shown as percentages of the weights', () => {
  assert.equal(wheelOdds(meta()), '3 💎 — 75%\nПеремешать — 25%');
});
