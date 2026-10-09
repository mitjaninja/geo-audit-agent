import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signInitData, validateInitData } from '../src/auth.ts';
import { canPlay, fullLives, LIFE_REGEN_MS, MAX_LIVES, refund, regen, spend, view } from '../src/lives.ts';

const TOKEN = '123456:TEST-token';
const NOW = 1_760_000_000_000;
const fields = (over: Record<string, string> = {}) => ({
  auth_date: String(Math.floor(NOW / 1000) - 60),
  query_id: 'AAH',
  user: JSON.stringify({ id: 42, first_name: 'Мика', username: 'mika', language_code: 'ru' }),
  ...over,
});

test('initData: valid signature is accepted and parsed', () => {
  const data = validateInitData(signInitData(fields({ start_param: 'room_abc' }), TOKEN), TOKEN, NOW);
  assert.deepEqual(data?.user, { id: 42, firstName: 'Мика', username: 'mika', languageCode: 'ru' });
  assert.equal(data?.startParam, 'room_abc');
});

test('initData: tampering, wrong token, stale or future dates are rejected', () => {
  const good = signInitData(fields(), TOKEN);
  assert.equal(validateInitData(good, 'other:token', NOW), null);
  assert.equal(validateInitData(good.replace('mika', 'evil'), TOKEN, NOW), null);
  assert.equal(validateInitData(good + '&extra=1', TOKEN, NOW), null);
  assert.equal(validateInitData(good, TOKEN, NOW + 25 * 3600_000), null, 'older than a day');
  assert.equal(validateInitData(signInitData(fields({ auth_date: String(NOW / 1000 + 3600) }), TOKEN), TOKEN, NOW), null);
  assert.equal(validateInitData('', TOKEN, NOW), null);
  assert.equal(validateInitData('hash=zz', TOKEN, NOW), null);
  assert.equal(validateInitData(signInitData(fields({ user: '{"id":-1}' }), TOKEN), TOKEN, NOW), null);
  assert.equal(validateInitData(signInitData(fields({ user: 'not json' }), TOKEN), TOKEN, NOW), null);
});

test('initData: the newer signature field takes part in the hash like any other field', () => {
  const raw = signInitData(fields({ signature: 'abc' }), TOKEN);
  assert.ok(validateInitData(raw, TOKEN, NOW));
  assert.equal(validateInitData(raw.replace('signature=abc', 'signature=abd'), TOKEN, NOW), null);
});

test('lives: spend, regenerate one per 30 minutes, cap at 5', () => {
  let s = fullLives(NOW);
  s = spend(s, NOW);
  s = spend(s, NOW);
  assert.equal(view(s, NOW).lives, 3);
  assert.equal(view(s, NOW).nextLifeAt, NOW + LIFE_REGEN_MS);
  assert.equal(view(s, NOW + LIFE_REGEN_MS - 1).lives, 3);
  assert.equal(view(s, NOW + LIFE_REGEN_MS).lives, 4);
  // остаток интервала не теряется
  const later = regen(s, NOW + LIFE_REGEN_MS * 1.5);
  assert.equal(later.lives, 4);
  assert.equal(view(later, NOW + LIFE_REGEN_MS * 1.5).nextLifeAt, NOW + 2 * LIFE_REGEN_MS);
  assert.equal(view(s, NOW + LIFE_REGEN_MS * 10).lives, MAX_LIVES);
  assert.equal(view(s, NOW + LIFE_REGEN_MS * 10).nextLifeAt, null);
});

test('lives: the regen timer starts when the first life is spent, not earlier', () => {
  const s = spend(fullLives(NOW - 10 * LIFE_REGEN_MS), NOW);
  assert.equal(view(s, NOW).nextLifeAt, NOW + LIFE_REGEN_MS);
});

test('lives: empty means no play; refund returns a life; infinite lives are not spent', () => {
  let s = fullLives(NOW);
  for (let i = 0; i < MAX_LIVES; i++) s = spend(s, NOW);
  assert.equal(canPlay(s, NOW), false);
  assert.throws(() => spend(s, NOW));
  assert.equal(canPlay(s, NOW + LIFE_REGEN_MS), true);
  assert.equal(refund(s, NOW).lives, 1);
  const inf = { ...s, infiniteUntil: NOW + 3600_000 };
  assert.equal(canPlay(inf, NOW), true);
  assert.equal(spend(inf, NOW).lives, 0);
  assert.equal(view(inf, NOW).infiniteUntil, NOW + 3600_000);
  assert.equal(view(inf, NOW).nextLifeAt, null);
});
