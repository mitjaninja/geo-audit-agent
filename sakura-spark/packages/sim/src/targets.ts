import type { LevelDef } from '@sakura/core';

export interface WinRateBand {
  readonly min: number;
  readonly max: number;
}

/**
 * Целевой win rate из PRD («Экономика и сложность»):
 * 1–20 — 90%+, 21–60 — 60–70%, 60+ — 40–55%, Hard — 25–35%, Super Hard — 15–20%.
 */
export function targetBand(level: Pick<LevelDef, 'id' | 'difficulty'>): WinRateBand {
  if (level.difficulty === 'superHard') return { min: 0.15, max: 0.2 };
  if (level.difficulty === 'hard') return { min: 0.25, max: 0.35 };
  if (level.id <= 20) return { min: 0.9, max: 1 };
  if (level.id <= 60) return { min: 0.6, max: 0.7 };
  return { min: 0.4, max: 0.55 };
}
