import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '@sakura/core';
import type { LevelDef } from '@sakura/core';

/** Уровни из каталога JSON. Ошибка в любом файле останавливает старт — лучше, чем битый уровень у игроков. */
export function loadLevels(dir: string): Map<number, LevelDef> {
  const levels = new Map<number, LevelDef>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const level = parseLevel(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (levels.has(level.id)) throw new Error(`duplicate level id ${level.id} in ${file}`);
    levels.set(level.id, level);
  }
  return levels;
}
