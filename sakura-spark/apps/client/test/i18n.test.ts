import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ITEM_INFO } from '../src/economy.ts';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';
import { pt } from '../src/i18n/pt.ts';
import { ru } from '../src/i18n/ru.ts';
import { languageFor, localized, setLanguage, t } from '../src/i18n.ts';
import { episodes } from '../src/map.ts';
import { rewardText, taskText } from '../src/meta.ts';

afterEach(() => setLanguage('ru'));

test('language from the Telegram code: ru for RU/UA/BY/KZ, es, pt, otherwise en; no code — ru', () => {
  assert.equal(languageFor('ru'), 'ru');
  assert.equal(languageFor('uk'), 'ru');
  assert.equal(languageFor('es-MX'), 'es');
  assert.equal(languageFor('pt-br'), 'pt');
  assert.equal(languageFor('de'), 'en');
  assert.equal(languageFor(null), 'ru');
});

test('switching the language changes texts everywhere: dictionary, items, districts, rewards, tasks, level lines', () => {
  setLanguage('en');
  assert.equal(t.toMap, 'To the map');
  assert.equal(ITEM_INFO.hammer.name, 'Pon’s hammer');
  assert.equal(episodes(30)[1]!.name, 'Market Street');
  assert.equal(rewardText({ items: { shuffle: 2 }, infiniteLivesMs: 30 * 60_000, card: 'mika_yukata' }), 'Shuffle ×2, ∞ lives 30 min, card “Mika in a yukata”');
  assert.equal(taskText({ kind: 'win', target: 1, progress: 0, claimed: false, reward: {} }), 'Clear 1 level');
  assert.equal(localized({ text: 'Привет', i18n: { en: 'Hi' } }), 'Hi');
  assert.equal(localized({ text: 'Привет' }), 'Привет', 'no translation — the original');
  setLanguage('pt');
  assert.equal(t.economy.extendBuy(5, 9), '+5 jogadas · 9 💎');
  setLanguage('ru');
  assert.equal(localized({ text: 'Привет', i18n: { en: 'Hi' } }), 'Привет');
});

test('every dictionary is complete: same districts, colours, cards and no empty strings', () => {
  const flat = (o: unknown, path = ''): [string, unknown][] => typeof o === 'object' && o !== null && !Array.isArray(o)
    ? Object.entries(o).flatMap(([k, v]) => flat(v, `${path}.${k}`)) : [[path, o]];
  const keys = (o: unknown) => flat(o).map(([k]) => k).sort();
  for (const d of [en, es, pt]) {
    assert.deepEqual(keys(d), keys(ru));
    assert.equal(d.districts.length, ru.districts.length);
    assert.equal(d.colors.length, ru.colors.length);
    for (const [k, v] of flat(d)) if (typeof v === 'string') assert.ok(v.length > 0, k);
  }
});
