import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  readonly id: number;
  readonly firstName: string;
  readonly username?: string;
  readonly languageCode?: string;
  /** Пользователь разрешил боту писать в личку (initData allows_write_to_pm) — для пушей. */
  readonly allowsPm?: boolean;
}

export interface InitData {
  readonly user: TelegramUser;
  readonly authDate: number;
  /** Параметр startapp из ссылки t.me/<bot>/<app>?startapp=… — понадобится комнатам чат-режимов. */
  readonly startParam?: string;
}

/** initData старше суток не принимаем: подпись верна, но сессию надо обновить. */
export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Проверка initData Mini App (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key="WebAppData", botToken); hash = HMAC_SHA256(key=secret, data_check_string),
 * где data_check_string — все поля, кроме hash, по алфавиту, «key=value» через \n.
 * Возвращает null при любой ошибке — причину наружу не отдаём.
 */
export function validateInitData(raw: string, botToken: string, nowMs: number, maxAgeSec = INIT_DATA_MAX_AGE_SEC): InitData | null {
  if (!raw || !botToken) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isInteger(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 60) return null;

  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  if (typeof user !== 'object' || user === null) return null;
  const u = user as Record<string, unknown>;
  if (!Number.isSafeInteger(u.id) || (u.id as number) <= 0) return null;
  const startParam = params.get('start_param');
  return {
    user: {
      id: u.id as number,
      firstName: typeof u.first_name === 'string' ? u.first_name : '',
      ...(typeof u.username === 'string' ? { username: u.username } : {}),
      ...(typeof u.language_code === 'string' ? { languageCode: u.language_code } : {}),
      ...(typeof u.allows_write_to_pm === 'boolean' ? { allowsPm: u.allows_write_to_pm } : {}),
    },
    authDate,
    ...(startParam ? { startParam } : {}),
  };
}

/** Подписать initData — для тестов и dev-инструментов (то же, что делает Telegram). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
