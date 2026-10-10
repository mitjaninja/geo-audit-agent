import type { Item, MetaView, Reward, TaskState } from './api.ts';
import { ITEM_INFO } from './economy.ts';
import { t } from './i18n.ts';

/** Названия карточек — из словаря языка игрока. */
export const cardTitle = (id: string): string => t.cards[id] ?? id;

/** «Молот Пона, 2 💎, ∞ жизни 30 мин, карточка «Мика в юкате»». */
export function rewardText(r: Reward): string {
  const parts: string[] = [];
  for (const [item, n] of Object.entries(r.items ?? {}) as [Item, number][]) parts.push(n > 1 ? `${ITEM_INFO[item].name} ×${n}` : ITEM_INFO[item].name);
  if (r.crystals) parts.push(`${r.crystals} 💎`);
  if (r.infiniteLivesMs) parts.push(t.reward.lives(Math.round(r.infiniteLivesMs / 60_000)));
  if (r.card) parts.push(t.reward.card(cardTitle(r.card)));
  if (r.frame) parts.push(t.reward.frame(t.frames[r.frame] ?? r.frame));
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

export function taskText(task: TaskState): string {
  const n = task.target;
  switch (task.kind) {
    case 'win': return t.tasks.win(n);
    case 'stars': return t.tasks.stars(n);
    case 'threeStars': return t.tasks.threeStars;
    case 'booster': return t.tasks.booster(n);
    case 'score': return t.tasks.score(n);
    case 'room': return t.tasks.room;
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
