import type { Goal } from '@sakura/core';

import { en } from './i18n/en.ts';
import { es } from './i18n/es.ts';
import { pt } from './i18n/pt.ts';
import { ru } from './i18n/ru.ts';
import type { Strings } from './i18n/ru.ts';

export type { Strings };
export type Lang = 'ru' | 'en' | 'es' | 'pt';
const DICTS: Readonly<Record<Lang, Strings>> = { ru, en, es, pt };

/**
 * Тексты интерфейса на языке игрока (PRD: RU, EN, ES, PT). Живая привязка ES-модуля:
 * setLanguage при запуске меняет t для всех, кто его импортировал.
 */
export let t: Strings = ru;
export let lang: Lang = 'ru';

/** Язык по коду Telegram (language_code): русский для RU/UA/BY/KZ, испанский, португальский, иначе английский. */
export function languageFor(code: string | null | undefined): Lang {
  if (!code) return 'ru';
  const c = code.toLowerCase().slice(0, 2);
  if (['ru', 'uk', 'be', 'kk'].includes(c)) return 'ru';
  if (c === 'es') return 'es';
  if (c === 'pt') return 'pt';
  return 'en';
}

export function setLanguage(l: Lang): void {
  lang = l;
  t = DICTS[l];
}

/** Текст из уровня (реплика, обучение) на языке игрока: перевод из i18n, иначе русский оригинал. */
export function localized(line: { readonly text: string; readonly i18n?: Readonly<Partial<Record<'en' | 'es' | 'pt', string>>> }): string {
  return lang === 'ru' ? line.text : line.i18n?.[lang] ?? line.text;
}

/** Короткая подпись цели для HUD. */
export function goalLabel(goal: Goal): string {
  switch (goal.type) {
    case 'score': return t.goals.score;
    case 'jelly': return t.goals.jelly;
    case 'lanterns': return t.goals.lanterns;
    case 'collect': return t.colors[goal.color] ?? t.goals.pieces;
    case 'fog': return t.goals.fog;
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
