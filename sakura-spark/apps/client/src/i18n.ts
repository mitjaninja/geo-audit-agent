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
  toMap: 'На карту',
  tapToContinue: 'нажми, чтобы продолжить ▸',
  room: {
    title: 'Челлендж чата',
    subtitle: (level: number, creator: string) => `уровень ${level} · зовёт ${creator}`,
    endsIn: (time: string) => `до конца ${time}`,
    ended: 'Челлендж завершён',
    empty: 'Пока никто не сыграл — будь первым!',
    you: 'ты',
    players: (n: number) => `Сыграли: ${n}`,
    playFree: 'Играть — бесплатно',
    playLife: 'Играть · ♥ 1',
    toRanking: 'К рейтингу',
    place: (place: number, players: number) => `Место в чате: ${place} из ${players}`,
    notFound: 'Комната не найдена — возможно, она закрыта.',
  },
  share: {
    invite: '💬 В чат',
    askLife: 'Попросить жизнь в чате',
    onlyTelegram: 'Позвать друзей можно, когда игра открыта в Telegram.',
    limit: 'На сегодня хватит карточек: можно 5 в день.',
    title: 'Позвать друзей',
  },
  exitTitle: 'Выйти из уровня?',
  exitText: 'Попытка засчитается как проигрыш — жизнь сгорит.',
  exitYes: 'Выйти',
  exitNo: 'Остаться',
  next: 'Дальше',
  bonus: (n: number) => `Финальный салют +${n}`,
  noMoves: 'Перемешиваем…',
  lives: (n: number, max: number) => `♥ ${n}/${max}`,
  livesInfinite: '♥ ∞',
  nextLife: (time: string) => `Следующая жизнь через ${time}`,
  noLivesTitle: 'Жизни закончились',
  noLivesText: 'Фонарики-сердечки восстанавливаются сами: одна жизнь каждые 30 минут.',
  tryAgain: 'Проверить',
  loading: 'Загрузка…',
  offline: 'Нет связи с сервером — играем без сохранения',
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
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
