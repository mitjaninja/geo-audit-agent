import type { Item, ShopView } from './api.ts';

/** Бустеры в интерфейсе: название, подсказка, когда применяются. */
export const ITEM_INFO: Readonly<Record<Item, { readonly name: string; readonly hint: string; readonly when: 'start' | 'game' }>> = {
  beamBomb: { name: 'Луч и бомба', hint: 'На старте на поле появятся луч фонаря и бумажная бомба', when: 'start' },
  rainbow: { name: 'Радужный кристалл', hint: 'На старте на поле появится радужный кристалл', when: 'start' },
  extraMoves: { name: '+3 хода', hint: 'Три дополнительных хода на уровень', when: 'start' },
  hammer: { name: 'Молот Пона', hint: 'Убрать одну фишку или ударить по блокеру', when: 'game' },
  freeSwap: { name: 'Свободный обмен', hint: 'Поменять соседние фишки без тройки', when: 'game' },
  shuffle: { name: 'Перемешать', hint: 'Перемешать поле', when: 'game' },
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
