/**
 * Дописать переводы реплик (INTRO_I18N) в levels/*.json: npm run localize-levels.
 * Реплика без перевода — предупреждение: переведите её в src/intro-i18n.ts.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLevel } from '@sakura/core';
import { withI18n } from './intro-i18n.ts';
import { formatLevel } from './tune.ts';

const dir = resolve(import.meta.dirname, '../../../levels');
let changed = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown> & { intro?: { text: string }[]; tutorial?: { text: string } };
  const next = {
    ...raw,
    ...(raw.intro ? { intro: raw.intro.map(withI18n) } : {}),
    ...(raw.tutorial ? { tutorial: withI18n(raw.tutorial) } : {}),
  };
  for (const l of [...(next.intro ?? []), ...(next.tutorial ? [next.tutorial] : [])]) {
    if (!('i18n' in l)) console.warn(`${f}: no translation for «${l.text}»`);
  }
  const text = formatLevel(next);
  if (text !== readFileSync(join(dir, f), 'utf8')) {
    parseLevel(JSON.parse(text));
    writeFileSync(join(dir, f), text);
    changed++;
  }
}
console.log(`localized: ${changed} files`);
