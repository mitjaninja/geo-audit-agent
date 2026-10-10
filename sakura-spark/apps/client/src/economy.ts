import type { Item, ShopView } from './api.ts';
import { t } from './i18n.ts';

/** Бустеры в интерфейсе: название, подсказка, когда применяются. */
// геттеры: название — на языке игрока, выбранном при запуске
export const ITEM_INFO: Readonly<Record<Item, { readonly name: string; readonly hint: string; readonly when: 'start' | 'game' }>> = {
  get beamBomb() { return { ...t.items.beamBomb, when: 'start' as const }; },
  get rainbow() { return { ...t.items.rainbow, when: 'start' as const }; },
  get extraMoves() { return { ...t.items.extraMoves, when: 'start' as const }; },
  get hammer() { return { ...t.items.hammer, when: 'game' as const }; },
  get freeSwap() { return { ...t.items.freeSwap, when: 'game' as const }; },
  get shuffle() { return { ...t.items.shuffle, when: 'game' as const }; },
};

export const START_ITEMS: readonly Item[] = ['beamBomb', 'rainbow', 'extraMoves'];
export const GAME_ITEMS: readonly Item[] = ['hammer', 'freeSwap', 'shuffle'];

export const crystals = (n: number): string => `${n} 💎`;

/** Цена следующей докупки ходов (n — сколько уже куплено в этой попытке). */
export function nextExtendPrice(shop: Pick<ShopView, 'extendPrices'>, bought: number): number {
  return shop.extendPrices[Math.min(bought, shop.extendPrices.length - 1)]!;
}

/** Пакеты витрины по возрастанию цены. */
export function packList(shop: ShopView): { id: keyof ShopView['packs']; crystals: number; stars: number; bonus: number; title: string }[] {
  return (Object.entries(shop.packs) as [keyof ShopView['packs'], ShopView['packs'][keyof ShopView['packs']]][])
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => a.stars - b.stars);
}
