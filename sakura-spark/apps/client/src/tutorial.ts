import type { Match3Game, Speaker, Swap } from '@sakura/core';

/** Персонажи PRD: имя и цвет аватарки-заглушки (пока нет арта). */
export const SPEAKERS: Readonly<Record<Speaker, { readonly name: string; readonly color: number }>> = {
  mika: { name: 'Мика', color: 0xff8fc0 },
  pon: { name: 'Пон', color: 0xb98a5e },
  ren: { name: 'Рэн', color: 0xff9a57 },
  setsu: { name: 'Сэцу', color: 0x8ec9ff },
};

/** Бездействие, после которого Пон подсказывает ход (мс). */
export const HINT_DELAY_MS = 7000;

/**
 * Ход для подсказки: примеряем каждый ход на копии партии с чужим сидом (досыпку не подсматриваем)
 * и берём тот, что снимает больше фишек и рождает спецфишки.
 */
export function pickHint(game: Match3Game): Swap | null {
  let best: Swap | null = null;
  let bestValue = -1;
  for (const swap of game.validSwaps()) {
    const copy = game.clone(0x48494e54);
    const res = copy.swap(swap);
    const first = res.events.find((e) => e.type === 'cascade');
    if (first?.type !== 'cascade') continue;
    const value = first.step.cleared.length + first.step.created.length * 3 + (first.step.combo ? 10 : 0);
    if (value > bestValue) {
      bestValue = value;
      best = swap;
    }
  }
  return best;
}

export const sameSwap = (x: Swap, y: Swap): boolean => {
  const eq = (p: Swap['a'], q: Swap['a']) => p.row === q.row && p.col === q.col;
  return (eq(x.a, y.a) && eq(x.b, y.b)) || (eq(x.a, y.b) && eq(x.b, y.a));
};

/** Какие вступления уже показаны. Хранилище браузера может быть недоступно — тогда просто покажем снова. */
export interface SeenStore {
  has(levelId: number): boolean;
  add(levelId: number): void;
}

export function seenIntros(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key = 'sakura.intros'): SeenStore {
  let seen = new Set<number>();
  try {
    seen = new Set((JSON.parse(storage?.getItem(key) ?? '[]') as unknown[]).filter((n): n is number => Number.isInteger(n)));
  } catch {
    // битые данные — начинаем с нуля
  }
  return {
    has: (id) => seen.has(id),
    add: (id) => {
      seen.add(id);
      try {
        storage?.setItem(key, JSON.stringify([...seen]));
      } catch {
        // приватный режим, квота — не критично
      }
    },
  };
}
