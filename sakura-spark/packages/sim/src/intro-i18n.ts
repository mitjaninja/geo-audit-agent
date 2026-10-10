/**
 * Переводы реплик персонажей (вступления уровней и обучающий ход). Ключ — русский текст из JSON уровня.
 * `npm run localize-levels` дописывает их в levels/*.json полем i18n; генератор берёт их сразу.
 */
import type { Translations } from '@sakura/core';

export const INTRO_I18N: Readonly<Record<string, Translations>> = {
  'Я Мика, ученица храма огней. Курогири украл фестивальные фонари, и сакура в Хоширо больше не цветёт…': {
    en: 'I’m Mika, an apprentice at the Temple of Lights. Kurogiri stole the festival lanterns, and the sakura in Hoshiro no longer blooms…',
    es: 'Soy Mika, aprendiz del Templo de las Luces. Kurogiri robó los farolillos del festival y el sakura de Hoshiro ya no florece…',
    pt: 'Sou a Mika, aprendiz do Templo das Luzes. Kurogiri roubou as lanternas do festival, e a sakura de Hoshiro não floresce mais…',
  },
  'Поможешь вернуть свет? Начнём с храма — собирай кристаллы по три!': {
    en: 'Will you help bring the light back? Let’s start at the temple — match crystals in threes!',
    es: '¿Me ayudas a recuperar la luz? Empecemos por el templo — ¡junta cristales de tres en tres!',
    pt: 'Você me ajuda a trazer a luz de volta? Vamos começar pelo templo — junte cristais de três em três!',
  },
  'Потяни звезду вниз — три одинаковых кристалла в ряд исчезнут!': {
    en: 'Drag the star down — three matching crystals in a row will vanish!',
    es: 'Arrastra la estrella hacia abajo — ¡tres cristales iguales en fila desaparecerán!',
    pt: 'Arraste a estrela para baixo — três cristais iguais em fila vão sumir!',
  },
  'Я тануки Пон! Секрет: собери 4 в ряд — получишь Луч фонаря. Он сметает целую линию!': {
    en: 'I’m Pon the tanuki! Secret: match 4 in a row to get a Lantern beam. It clears a whole line!',
    es: '¡Soy Pon, el tanuki! Secreto: junta 4 en fila y tendrás un Rayo de farol. ¡Barre una línea entera!',
    pt: 'Eu sou o Pon, o tanuki! Segredo: junte 4 em fila e ganhe um Raio de lanterna. Ele limpa uma linha inteira!',
  },
  'Храму нужны звёзды. Собери их — счётчик сверху покажет, сколько осталось.': {
    en: 'The temple needs stars. Collect them — the counter at the top shows how many are left.',
    es: 'El templo necesita estrellas. Recógelas — el contador de arriba muestra cuántas faltan.',
    pt: 'O templo precisa de estrelas. Junte-as — o contador lá em cima mostra quantas faltam.',
  },
  'Собери фигуру буквой Г или Т — выйдет Бумажная бомба. Бум — и квадрат 3×3 чист!': {
    en: 'Make an L or T shape to get a Paper bomb. Boom — and a 3×3 square is clear!',
    es: 'Forma una L o una T y saldrá una Bomba de papel. ¡Bum — y un cuadrado de 3×3 queda limpio!',
    pt: 'Forme um L ou um T para ganhar uma Bomba de papel. Bum — e um quadrado 3×3 fica limpo!',
  },
  'Под кристаллами — сладкое желе. Собирай фишки прямо над ним, пока всё желе не исчезнет.': {
    en: 'There’s sweet jelly under the crystals. Match pieces right on top of it until all the jelly is gone.',
    es: 'Bajo los cristales hay gelatina dulce. Combina fichas justo encima hasta que desaparezca toda.',
    pt: 'Debaixo dos cristais há geleia doce. Combine peças bem em cima dela até toda a geleia sumir.',
  },
  'Лёд! Собирай кристаллы рядом со льдом — он треснет. Сквозь лёд фишки падают как ни в чём не бывало.': {
    en: 'Ice! Match crystals next to the ice and it will crack. Pieces fall through ice as if it weren’t there.',
    es: '¡Hielo! Combina cristales junto al hielo y se agrietará. Las fichas caen a través del hielo como si nada.',
    pt: 'Gelo! Combine cristais ao lado do gelo e ele racha. As peças caem através do gelo como se nada fosse.',
  },
  'Я Рэн, мастер фонарей. Собери пять в ряд — получишь Радужный кристалл: он убирает все фишки одного цвета.': {
    en: 'I’m Ren, the lantern master. Match five in a row to get a Rainbow crystal: it removes every piece of one colour.',
    es: 'Soy Ren, maestro de farolillos. Junta cinco en fila y tendrás un Cristal arcoíris: quita todas las fichas de un color.',
    pt: 'Sou o Ren, mestre das lanternas. Junte cinco em fila e ganhe um Cristal arco-íris: ele tira todas as peças de uma cor.',
  },
  'Наши фонарики! Их нельзя взорвать — опусти их на самый низ, убирая кристаллы под ними.': {
    en: 'Our lanterns! They can’t be blasted — bring them down to the very bottom by clearing the crystals below.',
    es: '¡Nuestros farolillos! No se pueden explotar — bájalos hasta el fondo quitando los cristales de debajo.',
    pt: 'Nossas lanternas! Não dá para explodi-las — leve-as até o fundo tirando os cristais de baixo.',
  },
  'Лианы глициний держат кристалл: его нельзя двигать, но можно собрать в ряд — и лианы опадут.': {
    en: 'Wisteria vines hold a crystal: you can’t move it, but you can match it — and the vines fall away.',
    es: 'Las enredaderas de glicinia sujetan un cristal: no puedes moverlo, pero sí combinarlo — y caerán.',
    pt: 'Trepadeiras de glicínia prendem um cristal: não dá para movê-lo, mas dá para combiná-lo — e elas caem.',
  },
  'Фестиваль не ждёт! Здесь нет счёта ходов — только 90 секунд. Успеешь набрать очки?': {
    en: 'The festival won’t wait! No move limit here — just 90 seconds. Can you score in time?',
    es: '¡El festival no espera! Aquí no hay límite de movimientos — solo 90 segundos. ¿Llegarás a sumar puntos?',
    pt: 'O festival não espera! Aqui não há limite de jogadas — só 90 segundos. Consegue pontuar a tempo?',
  },
  'Запертые сундуки! Собирай рядом — замки слетят, а внутри найдётся луч или бомба.': {
    en: 'Locked chests! Match next to them — the locks pop off, and inside you’ll find a beam or a bomb.',
    es: '¡Cofres cerrados! Combina a su lado — los candados saltan y dentro hay un rayo o una bomba.',
    pt: 'Baús trancados! Combine ao lado — as trancas caem, e dentro há um raio ou uma bomba.',
  },
  'Это туман Курогири! Если не трогать его ход за ходом — он расползается и съедает кристаллы.': {
    en: 'This is Kurogiri’s fog! Leave it alone move after move and it spreads, swallowing crystals.',
    es: '¡Es la niebla de Kurogiri! Si no la tocas jugada tras jugada, se extiende y se traga los cristales.',
    pt: 'É a névoa de Kurogiri! Se você não mexer nela jogada após jogada, ela se espalha e engole cristais.',
  },
  'Разгони весь туман — и Храмовый холм снова засияет!': {
    en: 'Clear all the fog — and Temple Hill will shine again!',
    es: '¡Despeja toda la niebla — y la Colina del Templo volverá a brillar!',
    pt: 'Dissipe toda a névoa — e a Colina do Templo vai brilhar de novo!',
  },
  'Добро пожаловать на Торговую улицу! Шоколадные дайфуку не боятся простых троек — только лучей и бомб.': {
    en: 'Welcome to Market Street! Chocolate daifuku don’t fear plain matches — only beams and bombs.',
    es: '¡Bienvenido a la Calle del Mercado! Los daifuku de chocolate no temen tríos simples — solo rayos y bombas.',
    pt: 'Bem-vindo à Rua do Mercado! Os daifuku de chocolate não temem trios simples — só raios e bombas.',
  },
  'Порталы! Кристалл, упавший в портал, вылетает из другого. Следи за стрелками дорожки.': {
    en: 'Portals! A crystal that falls into a portal pops out of the other one. Watch the arrows.',
    es: '¡Portales! Un cristal que cae en un portal sale por el otro. Fíjate en las flechas.',
    pt: 'Portais! Um cristal que cai num portal sai pelo outro. Repare nas setas.',
  },
  'Курогири сам явился на Торговую улицу! Его туман гуще, чем на холме…': {
    en: 'Kurogiri himself has come to Market Street! His fog is thicker than on the hill…',
    es: '¡El mismísimo Kurogiri ha llegado a la Calle del Mercado! Su niebla es más espesa que en la colina…',
    pt: 'O próprio Kurogiri apareceu na Rua do Mercado! A névoa dele é mais densa que na colina…',
  },
  'Береги лучи и бомбы — без них дайфуку не пробить. Удачи!': {
    en: 'Save your beams and bombs — you can’t break daifuku without them. Good luck!',
    es: 'Guarda los rayos y las bombas — sin ellos no romperás los daifuku. ¡Suerte!',
    pt: 'Guarde os raios e as bombas — sem eles não dá para quebrar os daifuku. Boa sorte!',
  },
  'Порт фонарей! Здесь корабли привозили огни со всего света.': {
    en: 'Lantern Port! Ships brought lights here from all over the world.',
    es: '¡El Puerto de Farolillos! Aquí los barcos traían luces de todo el mundo.',
    pt: 'O Porto das Lanternas! Aqui os navios traziam luzes do mundo inteiro.',
  },
  'Курогири спрятал их в трюмах. Поможешь достать?': {
    en: 'Kurogiri hid them in the ships’ holds. Will you help get them out?',
    es: 'Kurogiri los escondió en las bodegas. ¿Me ayudas a sacarlos?',
    pt: 'Kurogiri as escondeu nos porões. Você me ajuda a tirá-las de lá?',
  },
  'Зимний квартал. Лёд тут крепче, чем на реке, — бей дважды.': {
    en: 'The Winter Quarter. The ice here is tougher than on the river — hit it twice.',
    es: 'El Barrio de Invierno. Aquí el hielo es más duro que el del río — golpéalo dos veces.',
    pt: 'O Bairro de Inverno. Aqui o gelo é mais duro que o do rio — bata duas vezes.',
  },
  'Небесный мост висит над облаками. Смотри под ноги — в нём дыры!': {
    en: 'The Sky Bridge hangs above the clouds. Watch your step — it has holes!',
    es: 'El Puente Celeste cuelga sobre las nubes. ¡Mira dónde pisas — tiene agujeros!',
    pt: 'A Ponte Celeste fica acima das nuvens. Cuidado onde pisa — ela tem buracos!',
  },
  'Сад фонтанов! Вода смывает туман, а мы смоем остальное.': {
    en: 'The Fountain Garden! The water washes away the fog, and we’ll wash away the rest.',
    es: '¡El Jardín de Fuentes! El agua se lleva la niebla, y nosotros nos llevaremos el resto.',
    pt: 'O Jardim das Fontes! A água leva a névoa embora, e nós levamos o resto.',
  },
  'Бамбуковая роща. Лианы тут растут быстрее, чем я плету фонари.': {
    en: 'The Bamboo Grove. Vines grow here faster than I can weave lanterns.',
    es: 'El Bosque de Bambú. Aquí las enredaderas crecen más rápido de lo que tejo farolillos.',
    pt: 'O Bosque de Bambu. Aqui as trepadeiras crescem mais rápido do que eu teço lanternas.',
  },
  'Квартал мастеров: здесь делают сундуки, которые не открыть одним ударом.': {
    en: 'The Artisans’ Quarter: they make chests here that won’t open with a single blow.',
    es: 'El Barrio de Artesanos: aquí hacen cofres que no se abren de un solo golpe.',
    pt: 'O Bairro dos Artesãos: aqui fazem baús que não abrem com um golpe só.',
  },
  'Лунная гавань. Ночью фонари видно лучше — давай вернём их все.': {
    en: 'Moon Harbor. Lanterns are easier to see at night — let’s bring them all back.',
    es: 'La Bahía de la Luna. De noche los farolillos se ven mejor — recuperémoslos todos.',
    pt: 'A Baía da Lua. À noite as lanternas se veem melhor — vamos trazer todas de volta.',
  },
  'Чайные холмы. Дайфуку тут повсюду — не объешься!': {
    en: 'The Tea Hills. Daifuku everywhere — don’t overeat!',
    es: 'Las Colinas del Té. Hay daifuku por todas partes — ¡no te empaches!',
    pt: 'As Colinas do Chá. Tem daifuku por todo lado — não vá comer demais!',
  },
  'Звёздная башня. Порталы ведут с этажа на этаж.': {
    en: 'The Star Tower. Portals lead from floor to floor.',
    es: 'La Torre Estelar. Los portales llevan de un piso a otro.',
    pt: 'A Torre Estelar. Os portais levam de um andar a outro.',
  },
  'Река огней. Каждый вернувшийся фонарь плывёт по ней домой.': {
    en: 'The River of Lights. Every lantern you bring back floats home along it.',
    es: 'El Río de Luces. Cada farolillo recuperado navega por él de vuelta a casa.',
    pt: 'O Rio de Luzes. Cada lanterna recuperada navega por ele de volta para casa.',
  },
  'Императорский сад. Курогири рядом — я чувствую холод.': {
    en: 'The Imperial Garden. Kurogiri is near — I can feel the cold.',
    es: 'El Jardín Imperial. Kurogiri está cerca — siento el frío.',
    pt: 'O Jardim Imperial. Kurogiri está perto — sinto o frio.',
  },
  'Сердце фестиваля! Ещё немного — и сакура снова зацветёт.': {
    en: 'The Heart of the Festival! Just a little more — and the sakura will bloom again.',
    es: '¡El Corazón del Festival! Un poco más — y el sakura volverá a florecer.',
    pt: 'O Coração do Festival! Só mais um pouco — e a sakura vai florescer de novo.',
  },
  'Фестивальный забег: набери очки, пока горят песочные часы!': {
    en: 'Festival dash: score as much as you can while the hourglass runs!',
    es: 'Carrera del festival: ¡suma puntos mientras corre el reloj de arena!',
    pt: 'Corrida do festival: faça pontos enquanto a ampulheta corre!',
  },
};

/** Реплика с переводами (если перевод известен). */
export function withI18n<T extends { readonly text: string }>(line: T): T {
  const tr = INTRO_I18N[line.text];
  return tr ? { ...line, i18n: tr } : line;
}
