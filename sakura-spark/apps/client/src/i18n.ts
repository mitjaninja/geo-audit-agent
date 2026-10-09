import type { Goal } from '@sakura/core';

/** Тексты интерфейса. PRD: локализация EN/ES/PT — на этапе масштабирования, сейчас только RU. */
export const t = {
  moves: 'Ходы',
  time: 'Время',
  score: 'Очки',
  level: (n: number) => `Уровень ${n}`,
  win: 'Победа!',
  lose: 'Не хватило чуть-чуть',
  retry: 'Ещё раз',
  next: 'Дальше',
  bonus: (n: number) => `Финальный салют +${n}`,
  noMoves: 'Перемешиваем…',
} as const;

const COLOR_NAMES = ['звёзды', 'сердца', 'луны', 'лепестки', 'капли', 'листья'] as const;

/** Короткая подпись цели для HUD. */
export function goalLabel(goal: Goal): string {
  switch (goal.type) {
    case 'score': return 'Очки';
    case 'jelly': return 'Желе';
    case 'lanterns': return 'Фонарики';
    case 'collect': return COLOR_NAMES[goal.color] ?? 'Фишки';
    case 'fog': return 'Туман';
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
