# Карточки без своего арта

Генерируются через Figma AI (план «Dmitry Shiklaev's team», не X.place), 768×1024, затем
`resize 360×482 → public/art/card_<id>.webp` (WebP q78), исходник — в `art/source/card_<id>.jpg`,
id добавить в `CARD_ART` в `apps/client/src/art.ts` и убрать из `CARD_FALLBACK`.

Общий хвост промпта: «Collectible character card illustration for a casual anime mobile game, vertical,
no text, no frame. … Soft pastel palette, clean thick outlines, cel shading.»

Внешность: Мика — short pink-coral bob hair, small red paper-lantern hair ornament, amber eyes, white and red
shrine haori; Рэн — messy orange hair, patterned headband, dark indigo jacket; Сэцу — long silver-white hair
with pale blue tips, white snowflake kimono; Пон — round chibi tanuki, brown and cream fur, green leaf on head.

| id | сюжет |
| --- | --- |
| mika_sakura | Мика сидит под цветущей сакурой и ловит лепестки, весенний день |
| ren_market | Рэн у рыночного прилавка с фонариками и фруктами, без читаемых вывесок |
| setsu_snow | Сэцу кружится в снегопад в зимнем квартале с тёплыми окнами |
| temple_fox | лис-хранитель на ступенях храмового холма, тории и сакура |
| street_cat | кот на торговой улице среди фонариков и норэн |
| port_crane | журавль на пирсе порта фонарей, плавающие фонари |
| winter_owl | сова на заснеженном каменном фонаре зимнего квартала |
| bridge_dragon | маленький добрый дракон над небесным мостом в облаках |
| fountain_koi | карп кои в пруду сада фонтанов, кувшинки |
| bamboo_panda | панда в бамбуковой роще со светлячками |
| mika_kimono | Мика в праздничном кимоно на фестивальной площади |
| hanami_mika | Мика на пикнике ханами под сакурой, бэнто |
| tanabata_ren | Рэн вешает ленты-желания танабата на бамбук под звёздами |
| halloween_pon | Пон в маске-тыкве с фонариком-тыквой, милый, не страшный |
| newyear_setsu | Сэцу с новогодним фонарём, снег и фейерверки |
