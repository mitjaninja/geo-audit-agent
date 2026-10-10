/**
 * Remote config и A/B (PRD: цены, офферы и сложность без релиза клиента).
 *
 * Конфиг — JSON в базе, правится командой бота /config_set (только администраторы) и хранит историю.
 * Слои применяются по порядку: DEFAULT_ECONOMY → базовый конфиг → варианты активных экспериментов.
 * Вариант игрока — sha256(«id эксперимента:id игрока») по весам: стабилен и не требует хранения.
 */
import { createHash } from 'node:crypto';
import { DEFAULT_ECONOMY, isItem } from './economy.ts';
import type { Economy } from './economy.ts';
import type { LevelDef } from '@sakura/core';

type DeepPartial<T> = T extends readonly (infer _U)[] ? T : T extends object ? { readonly [K in keyof T]?: DeepPartial<T[K]> } : T;

/** Сдвиг сложности уровня: ходы и секунды к значению из файла уровня. */
export interface LevelTweak {
  readonly moves?: number;
  readonly time?: number;
}

export interface ConfigLayer {
  readonly economy?: DeepPartial<Economy>;
  /** Ключ — id уровня. */
  readonly levels?: Readonly<Record<string, LevelTweak>>;
  /** Скрытое облегчение включается после стольких поражений подряд (по умолчанию 5). */
  readonly assistAfterLosses?: number;
}

export interface Variant {
  readonly name: string;
  readonly weight: number;
  readonly config: ConfigLayer;
}

export interface Experiment {
  readonly id: string;
  readonly active: boolean;
  readonly variants: readonly Variant[];
}

export interface RemoteConfig extends ConfigLayer {
  readonly experiments?: readonly Experiment[];
}

/** Итог для конкретного игрока. */
export interface Effective {
  readonly economy: Economy;
  readonly levels: Readonly<Record<string, LevelTweak>>;
  readonly assistAfterLosses: number;
  /** id эксперимента → вариант игрока (только активные). */
  readonly variants: Readonly<Record<string, string>>;
}

export const DEFAULT_ASSIST_AFTER = 5;
const MAX_MOVES_DELTA = 20;
const MAX_TIME_DELTA = 60;
const MIN_MOVES = 5;
const MIN_TIME = 20;

export class ConfigError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, path: string, min: number, max: number): number => {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new ConfigError(`${path}: целое от ${min} до ${max}`);
  return v as number;
};
const keysOnly = (v: Record<string, unknown>, allowed: readonly string[], path: string) => {
  const extra = Object.keys(v).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new ConfigError(`${path}: неизвестные поля ${extra.join(', ')}`);
};

/** Цены в Stars — не меньше 1; остальное — неотрицательные целые. */
const STAR_PRICES = /^(packs\.\w+|starter|piggy)\.stars$/;

/**
 * Проверка частичной экономики по образцу DEFAULT_ECONOMY: только существующие поля и тех же типов.
 * Исключение — starter.items: ключи — любые предметы склада.
 */
function checkEconomy(patch: unknown, template: unknown, path: string): void {
  const where = path || 'economy';
  if (typeof template === 'number') {
    int(patch, `economy.${path}`, STAR_PRICES.test(path) ? 1 : 0, 1_000_000);
  } else if (typeof template === 'string') {
    if (typeof patch !== 'string' || patch.length === 0 || patch.length > 64) throw new ConfigError(`economy.${path}: строка до 64 символов`);
  } else if (Array.isArray(template)) {
    if (!Array.isArray(patch) || patch.length < 1 || patch.length > 10) throw new ConfigError(`economy.${path}: список из 1–10 чисел`);
    patch.forEach((x, i) => int(x, `economy.${path}[${i}]`, 1, 1_000_000));
  } else if (isObj(template)) {
    if (!isObj(patch)) throw new ConfigError(`${where}: ожидается объект`);
    if (path === 'starter.items') {
      for (const [k, v] of Object.entries(patch)) {
        if (!isItem(k)) throw new ConfigError(`economy.starter.items: неизвестный предмет ${k}`);
        int(v, `economy.starter.items.${k}`, 0, 100);
      }
      return;
    }
    keysOnly(patch, Object.keys(template), where === 'economy' ? 'economy' : `economy.${path}`);
    for (const [k, v] of Object.entries(patch)) checkEconomy(v, template[k], path ? `${path}.${k}` : k);
  }
}

function parseLayer(v: unknown, path: string, levelIds: ReadonlySet<number> | null): ConfigLayer {
  if (!isObj(v)) throw new ConfigError(`${path || 'конфиг'}: ожидается объект`);
  const p = path ? `${path}.` : '';
  const out: { economy?: DeepPartial<Economy>; levels?: Record<string, LevelTweak>; assistAfterLosses?: number } = {};
  if (v.economy !== undefined) {
    checkEconomy(v.economy, DEFAULT_ECONOMY, '');
    out.economy = v.economy as DeepPartial<Economy>;
  }
  if (v.levels !== undefined) {
    if (!isObj(v.levels)) throw new ConfigError(`${p}levels: ожидается объект`);
    const levels: Record<string, LevelTweak> = {};
    for (const [id, t] of Object.entries(v.levels)) {
      const n = Number(id);
      if (!Number.isInteger(n) || String(n) !== id || (levelIds && !levelIds.has(n))) throw new ConfigError(`${p}levels: нет уровня ${id}`);
      if (!isObj(t)) throw new ConfigError(`${p}levels.${id}: ожидается объект`);
      keysOnly(t, ['moves', 'time'], `${p}levels.${id}`);
      levels[id] = {
        ...(t.moves !== undefined ? { moves: int(t.moves, `${p}levels.${id}.moves`, -MAX_MOVES_DELTA, MAX_MOVES_DELTA) } : {}),
        ...(t.time !== undefined ? { time: int(t.time, `${p}levels.${id}.time`, -MAX_TIME_DELTA, MAX_TIME_DELTA) } : {}),
      };
    }
    out.levels = levels;
  }
  if (v.assistAfterLosses !== undefined) out.assistAfterLosses = int(v.assistAfterLosses, `${p}assistAfterLosses`, 2, 100);
  return out;
}

/** Разобрать и проверить конфиг целиком. levelIds — чтобы не принять сдвиг несуществующего уровня. */
export function parseRemoteConfig(v: unknown, levelIds: ReadonlySet<number> | null = null): RemoteConfig {
  if (!isObj(v)) throw new ConfigError('конфиг: ожидается объект');
  keysOnly(v, ['economy', 'levels', 'assistAfterLosses', 'experiments'], 'конфиг');
  const base = parseLayer(v, '', levelIds);
  if (v.experiments === undefined) return base;
  if (!Array.isArray(v.experiments) || v.experiments.length > 10) throw new ConfigError('experiments: список до 10 экспериментов');
  const ids = new Set<string>();
  const experiments = v.experiments.map((e: unknown, i): Experiment => {
    const path = `experiments[${i}]`;
    if (!isObj(e)) throw new ConfigError(`${path}: ожидается объект`);
    keysOnly(e, ['id', 'active', 'variants'], path);
    if (typeof e.id !== 'string' || !/^[a-z0-9_]{1,32}$/.test(e.id)) throw new ConfigError(`${path}.id: латиница, цифры и _ до 32 символов`);
    if (ids.has(e.id)) throw new ConfigError(`${path}.id: повтор ${e.id}`);
    ids.add(e.id);
    if (typeof e.active !== 'boolean') throw new ConfigError(`${path}.active: true или false`);
    if (!Array.isArray(e.variants) || e.variants.length < 2 || e.variants.length > 5) throw new ConfigError(`${path}.variants: 2–5 вариантов`);
    const names = new Set<string>();
    const variants = e.variants.map((x: unknown, j): Variant => {
      const vp = `${path}.variants[${j}]`;
      if (!isObj(x)) throw new ConfigError(`${vp}: ожидается объект`);
      keysOnly(x, ['name', 'weight', 'config'], vp);
      if (typeof x.name !== 'string' || !/^[a-z0-9_]{1,16}$/.test(x.name) || names.has(x.name)) throw new ConfigError(`${vp}.name: уникальное, латиница до 16 символов`);
      names.add(x.name);
      const config = x.config === undefined ? {} : parseLayer(x.config, `${vp}.config`, levelIds);
      if (isObj(x.config)) keysOnly(x.config, ['economy', 'levels', 'assistAfterLosses'], `${vp}.config`);
      return { name: x.name, weight: int(x.weight, `${vp}.weight`, 1, 100), config };
    });
    return { id: e.id, active: e.active, variants };
  });
  return { ...base, experiments };
}

/** Вариант игрока: равномерный хеш по сумме весов. */
export function variantOf(exp: Experiment, userId: number): Variant {
  const h = createHash('sha256').update(`${exp.id}:${userId}`).digest().readUInt32BE(0);
  const total = exp.variants.reduce((s, v) => s + v.weight, 0);
  let x = h % total;
  for (const v of exp.variants) {
    if (x < v.weight) return v;
    x -= v.weight;
  }
  return exp.variants[exp.variants.length - 1]!;
}

function merge<T>(base: T, patch: unknown): T {
  if (!isObj(patch) || !isObj(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge((base as Record<string, unknown>)[k], v);
  return out as T;
}

/** Конфиг для игрока: базовая экономика + слои конфига + его варианты экспериментов. */
export function resolveConfig(cfg: RemoteConfig, userId: number, base: Economy = DEFAULT_ECONOMY): Effective {
  const variants: Record<string, string> = {};
  const layers: ConfigLayer[] = [cfg];
  for (const e of cfg.experiments ?? []) {
    if (!e.active) continue;
    const v = variantOf(e, userId);
    variants[e.id] = v.name;
    layers.push(v.config);
  }
  let economy = base;
  let levels: Record<string, LevelTweak> = {};
  let assistAfterLosses = DEFAULT_ASSIST_AFTER;
  for (const l of layers) {
    if (l.economy) economy = merge(economy, l.economy);
    if (l.levels) levels = { ...levels, ...l.levels };
    if (l.assistAfterLosses !== undefined) assistAfterLosses = l.assistAfterLosses;
  }
  return { economy, levels, assistAfterLosses, variants };
}

/** Ходы и время уровня после сдвига конфига (null — без изменений). */
export function tweakLevel(level: LevelDef, tweak: LevelTweak | undefined): { moves: number | null; timeLimit: number | null } {
  const moves = tweak?.moves ? Math.max(MIN_MOVES, level.moves + tweak.moves) : null;
  const timeLimit = tweak?.time && level.timeLimit !== undefined ? Math.max(MIN_TIME, level.timeLimit + tweak.time) : null;
  return { moves: moves === level.moves ? null : moves, timeLimit: timeLimit === level.timeLimit ? null : timeLimit };
}

/** Уровень с параметрами попытки — именно его получает клиент и проигрывает сервер. */
export function levelForAttempt(level: LevelDef, a: { readonly moves: number | null; readonly timeLimit: number | null }): LevelDef {
  if (a.moves === null && a.timeLimit === null) return level;
  return { ...level, ...(a.moves !== null ? { moves: a.moves } : {}), ...(a.timeLimit !== null ? { timeLimit: a.timeLimit } : {}) };
}

/** Порог скрытого облегчения: ядро считает от 5 поражений, конфиг сдвигает порог. */
export function lossStreakForAssist(lossStreak: number, assistAfterLosses: number): number {
  return lossStreak - (assistAfterLosses - DEFAULT_ASSIST_AFTER);
}
