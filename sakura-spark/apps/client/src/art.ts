/**
 * Растровый арт (public/art): портреты персонажей, фоны районов, карточки коллекции.
 * Чистый модуль: ключи текстур и пути к файлам; загрузку делает BootScene.
 */

export const CHARACTERS = ['mika', 'mika_win', 'mika_lose', 'pon', 'ren', 'setsu', 'kurogiri'] as const;
export type CharacterArt = (typeof CHARACTERS)[number];

/** Районов с фоном: дальше карта повторяет их по кругу, как и названия. */
export const DISTRICT_ART = 14;

/** Карточки, для которых нарисован свой арт. */
export const CARD_ART = ['mika_yukata', 'pon_lantern', 'ren_festival', 'setsu_moon'] as const;

export const charKey = (c: CharacterArt): string => `char-${c}`;
export const districtKey = (episode: number): string => `district-${((episode - 1) % DISTRICT_ART) + 1}`;

/** Пока у карточки нет своего арта — портрет её героя или фон района её жителя. */
const CARD_FALLBACK: Readonly<Record<string, string>> = {
  mika_sakura: charKey('mika_win'), mika_kimono: charKey('mika'), hanami_mika: charKey('mika_win'),
  ren_market: charKey('ren'), tanabata_ren: charKey('ren'),
  setsu_snow: charKey('setsu'), newyear_setsu: charKey('setsu'),
  halloween_pon: charKey('pon'),
  temple_fox: districtKey(1), street_cat: districtKey(2), port_crane: districtKey(3), winter_owl: districtKey(4),
  bridge_dragon: districtKey(5), fountain_koi: districtKey(6), bamboo_panda: districtKey(7),
};

export function cardKey(id: string): string | null {
  if ((CARD_ART as readonly string[]).includes(id)) return `card-${id}`;
  return CARD_FALLBACK[id] ?? null;
}

/** Все файлы арта: ключ текстуры → путь относительно index.html. */
export function artFiles(): { key: string; url: string }[] {
  return [
    ...CHARACTERS.map((c) => ({ key: charKey(c), url: `art/char_${c}.webp` })),
    ...Array.from({ length: DISTRICT_ART }, (_, i) => ({ key: districtKey(i + 1), url: `art/district_${i + 1}.webp` })),
    ...CARD_ART.map((id) => ({ key: `card-${id}`, url: `art/card_${id}.webp` })),
  ];
}
