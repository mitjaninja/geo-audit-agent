import type { Item, MetaView, Reward, TaskState } from './api.ts';
import { ITEM_INFO } from './economy.ts';

/** Карточки персонажей (награда 7-го дня календаря). Список — как на сервере (apps/server/src/meta.ts). */
export const CARD_TITLES: Readonly<Record<string, string>> = {
  mika_yukata: 'Мика в юкате',
  pon_lantern: 'Пон с фонариком',
  ren_festival: 'Рэн на фестивале',
  setsu_moon: 'Сэцу под луной',
  mika_sakura: 'Мика под сакурой',
  ren_market: 'Рэн на рынке',
  setsu_snow: 'Сэцу в снегопад',
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** «Молот Пона, 2 💎, ∞ жизни 30 мин, карточка «Мика в юкате»». */
export function rewardText(r: Reward): string {
  const parts: string[] = [];
  for (const [item, n] of Object.entries(r.items ?? {}) as [Item, number][]) parts.push(n > 1 ? `${ITEM_INFO[item].name} ×${n}` : ITEM_INFO[item].name);
  if (r.crystals) parts.push(`${r.crystals} 💎`);
  if (r.infiniteLivesMs) parts.push(`∞ жизни ${Math.round(r.infiniteLivesMs / 60_000)} мин`);
  if (r.card) parts.push(`карточка «${CARD_TITLES[r.card] ?? r.card}»`);
  return parts.join(', ');
}

/** Значок награды для клеток календаря и сегментов колеса: текстура или текст. */
export function rewardIcon(r: Reward): { texture: string } | { text: string } {
  if (r.card) return { text: '🎴' };
  const item = Object.keys(r.items ?? {})[0] as Item | undefined;
  if (item) return { texture: `b-${item}` };
  if (r.crystals) return { texture: 'crystal' };
  return { text: '♥' };
}

export function taskText(t: TaskState): string {
  const n = t.target;
  switch (t.kind) {
    case 'win': return `Пройди ${n} ${plural(n, 'уровень', 'уровня', 'уровней')}`;
    case 'stars': return `Собери ${n} ${plural(n, 'звезду', 'звезды', 'звёзд')}`;
    case 'threeStars': return 'Пройди уровень на 3 ★';
    case 'booster': return n === 1 ? 'Используй бустер' : `Используй ${n} бустера`;
    case 'score': return `Набери ${n.toLocaleString('ru-RU')} очков`;
    case 'room': return 'Сыграй челлендж в чате';
  }
}

/** Есть что забрать — красная точка на кнопке. */
export function metaBadges(m: MetaView): { daily: boolean; wheel: boolean } {
  return {
    daily: !m.login.claimedToday || m.stuck !== null
      || m.tasks.some((t) => !t.claimed && t.progress >= t.target)
      || m.chests.some((c) => c.tiers.some((x) => x.available && !x.claimed)),
    wheel: m.wheel.free,
  };
}

/** Шансы колеса — PRD требует раскрывать вероятности. */
export function wheelOdds(m: MetaView): string {
  const total = m.wheel.prizes.reduce((s, p) => s + p.weight, 0);
  return m.wheel.prizes.map((p) => `${rewardText(p.reward)} — ${Math.round((p.weight / total) * 1000) / 10}%`).join('\n');
}
