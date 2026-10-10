/**
 * Тексты бота и пушей на языке игрока (PRD: RU, EN, ES, PT). Язык — из language_code Telegram:
 * русский для RU/UA/BY/KZ (и если кода нет), испанский, португальский, иначе английский.
 */
export type Lang = 'ru' | 'en' | 'es' | 'pt';
export const LANGS: readonly Lang[] = ['ru', 'en', 'es', 'pt'];

export function langOf(code: string | null | undefined): Lang {
  if (!code) return 'ru';
  const c = code.toLowerCase().slice(0, 2);
  if (['ru', 'uk', 'be', 'kk'].includes(c)) return 'ru';
  if (c === 'es') return 'es';
  if (c === 'pt') return 'pt';
  return 'en';
}

const fmt = (n: number, locale: string) => n.toLocaleString(locale).replace(/[\u00a0\u202f]/g, ' ');

export interface Texts {
  readonly locale: string;
  readonly bot: {
    readonly description: string;
    readonly shortDescription: string;
    readonly commands: { readonly start: string; readonly paysupport: string; readonly terms: string; readonly notify: string };
    readonly paysupport: string;
    readonly terms: string;
    readonly paid: string;
    readonly start: (name: string) => string;
    readonly play: string;
    readonly notifyOn: string;
    readonly notifyOff: string;
    readonly myId: (id: number | string) => string;
    readonly pushFooter: string;
    readonly friend: string;
  };
  readonly push: {
    readonly lifeGift: (name: string) => string;
    readonly askLife: (name: string) => string;
    readonly askKey: (name: string) => string;
    readonly referralJoined: (name: string, level: number, crystals: number) => string;
    readonly referralReward: (name: string, level: number, crystals: number) => string;
    readonly overtook: (name: string, level: number) => string;
    readonly livesBack: string;
    readonly raceFirst: (name: string) => string;
    readonly challengeEnded: (place: number, players: number, crystals: number) => string;
    readonly teamLit: string;
    readonly duelWon: string;
  };
  readonly invoice: {
    readonly pack: (crystals: number, bonus: number) => string;
    readonly packTitles: Readonly<Record<string, string>>;
    readonly starterTitle: string;
    readonly starter: (crystals: number, hours: number) => string;
    readonly piggyTitle: string;
    readonly piggy: (crystals: number) => string;
    readonly passTitle: string;
    readonly pass: string;
  };
  readonly card: {
    readonly challengeTitle: string;
    readonly challengeDescription: (level: number) => string;
    readonly teamTitle: string;
    readonly teamDescription: (target: number) => string;
    readonly duelTitle: string;
    readonly duelDescription: (level: number) => string;
    readonly helpTitle: string;
    readonly helpDescription: string;
    readonly play: string;
    readonly top: string;
    readonly gift: string;
    readonly playGame: string;
    readonly limitTitle: string;
    readonly limitText: string;
    readonly roomStart: (creator: string, level: number) => string;
    readonly teamStart: (creator: string) => string;
    readonly duelStart: (creator: string, level: number) => string;
    readonly roomGone: string;
    readonly player: string;
    readonly level: (n: number) => string;
    readonly challengeBody: (creator: string) => string;
    readonly nobody: string;
    readonly challengeEnded: string;
    readonly played: (n: number, hours: number) => string;
    readonly playedMinutes: (n: number, minutes: number) => string;
    readonly boosted: string;
    readonly teamBody: (creator: string) => string;
    readonly teamProgress: (n: number, target: number) => string;
    readonly teamNobody: string;
    readonly teamDone: string;
    readonly teamFailed: string;
    readonly members: (n: number, hours: number) => string;
    readonly duelBody: (creator: string) => string;
    readonly duelMoves: (n: number) => string;
    readonly duelLost: (score: number) => string;
    readonly duelWaiting: string;
    readonly duelSecond: string;
    readonly duelWinner: (name: string) => string;
    readonly duelEnded: string;
    readonly minutesLeft: (n: number) => string;
    readonly helpBody: (name: string) => string;
    readonly gifts: (n: number, max: number) => string;
    readonly giftResult: Readonly<Record<'ok' | 'already' | 'full' | 'own' | 'expired' | 'not_found', string>>;
    readonly refreshed: string;
  };
  /** Страница-диплинк /t/<комната> для соцсетей и сторис: превью и переход в Telegram. */
  readonly landing: {
    readonly title: string;
    readonly description: (creator: string, level: number) => string;
    readonly game: string;
    readonly open: string;
  };
}

const ru: Texts = {
  locale: 'ru-RU',
  bot: {
    description: 'Sakura Spark — уютная match-3 в аниме-стиле. 🌸\n\nТёмный дух Курогири украл фестивальные фонари Хоширо, и сакура перестала цвести. '
      + 'Собирай светящиеся кристаллы по три и больше, открывай районы города и возвращай свет вместе с Микой и тануки Поном.\n\nИграй прямо в Telegram — и зови друзей в чаты.',
    shortDescription: 'Match-3 в аниме-стиле: собирай кристаллы, зажигай фонари и возвращай весну в Хоширо 🌸',
    commands: { start: 'Играть', paysupport: 'Помощь с покупками', terms: 'Условия', notify: 'Уведомления вкл/выкл' },
    paysupport: 'Помощь с покупками 🌸\n\nЕсли покупка не зачислилась или что-то пошло не так — напиши сюда, что случилось, '
      + 'и пришли код платежа из чека Telegram. Мы разберёмся и при необходимости вернём Stars.',
    terms: 'Sakura Spark — бесплатная игра. Кристаллы и бустеры — виртуальные предметы для использования только в игре, '
      + 'они не обмениваются на деньги. Покупки оплачиваются Telegram Stars; по спорным случаям — /paysupport.',
    paid: 'Готово! Покупка — уже в игре 🌸',
    start: (name) => `Привет, ${name}! 🌸\n\nКурогири украл фестивальные фонари, и сакура в Хоширо перестала цвести. Помоги Мике вернуть свет — собирай кристаллы по три и больше.`,
    play: 'Играть',
    notifyOn: 'Уведомления включены (не больше двух в день). Выключить: /notify off',
    notifyOff: 'Уведомления выключены. Включить: /notify on',
    myId: (id) => `Твой Telegram id: ${id}`,
    pushFooter: 'Выключить уведомления: /notify off',
    friend: 'Друг',
  },
  push: {
    lifeGift: (n) => `${n} подарил тебе жизнь ❤`,
    askLife: (n) => `${n} просит жизнь — подари в игре ❤`,
    askKey: (n) => `${n} просит ключ к новому району — помоги в игре 🔑`,
    referralJoined: (n, level, c) => `${n} пришёл по твоему приглашению! Когда дойдёт до уровня ${level} — получишь ${c} 💎`,
    referralReward: (n, level, c) => `${n} дошёл до уровня ${level} — тебе ${c} 💎!`,
    overtook: (n, level) => `${n} обогнал тебя на уровне ${level}! Отыграешься?`,
    livesBack: 'Жизни восстановились — Мика ждёт на карте! ❤ ×5',
    raceFirst: (n) => `${n} первым донёс фонарь в гонке! Ещё можно занять 2-е и 3-е место`,
    challengeEnded: (place, players, c) => `Турнир завершён: ты ${place}-й из ${players}. Награда: ${c ? `${c} 💎 и ` : ''}бустер «Перемешать»`,
    teamLit: 'Командный фонарь зажжён! Сундук: 3 💎, молот и радужный кристалл',
    duelWon: 'Ты победил в дуэли! Награда — радужный кристалл',
  },
  invoice: {
    pack: (c, bonus) => `${c} звёздных кристаллов${bonus ? ` (выгода ${bonus}%)` : ''}`,
    packTitles: { pack10: 'Горсть кристаллов', pack50: 'Мешочек кристаллов', pack100: 'Шкатулка кристаллов', pack250: 'Сундук кристаллов', pack500: 'Сокровищница' },
    starterTitle: 'Стартовый набор',
    starter: (c, h) => `${c} кристаллов, 3 бустера и ${h} ч бесконечных жизней`,
    piggyTitle: 'Копилка кристаллов',
    piggy: (c) => `Разбить копилку: ${c} кристаллов`,
    passTitle: 'Фестивальный пропуск',
    pass: 'Премиум-дорожка пропуска: бустеры, кристаллы и рамки. Подписка на 30 дней, продлевается сама',
  },
  card: {
    challengeTitle: 'Турнир на 1 час',
    challengeDescription: (l) => `Уровень ${l} · кто наберёт больше очков за час`,
    teamTitle: 'Командный фонарь',
    teamDescription: (t) => `Весь чат вместе зажигает ${t} огоньков за 48 часов`,
    duelTitle: 'Дуэль',
    duelDescription: (l) => `Уровень ${l} · один на один: кто пройдёт за меньшее число ходов, за час`,
    helpTitle: 'Попросить жизнь',
    helpDescription: 'Друзья в чате подарят фонарики-сердечки',
    play: '🌸 Играть',
    top: '🏆 Рейтинг',
    gift: '❤ Подарить жизнь',
    playGame: '🌸 Играть в Sakura Spark',
    limitTitle: 'На сегодня хватит карточек',
    limitText: 'Можно отправить 5 карточек в день — завтра будут новые 🌸',
    roomStart: (c, l) => `${c} зовёт в турнир на 1 час: уровень ${l}. У всех одна и та же раскладка — кто наберёт больше очков? Первая попытка бесплатно.`,
    teamStart: (c) => `${c} зажигает командный фонарь: каждая твоя партия добавляет огоньки. Цель выполнена — сундук всем, кто помог.`,
    duelStart: (c, l) => `${c} вызывает на дуэль: уровень ${l}, одна попытка. Побеждает тот, кто пройдёт за меньшее число ходов.`,
    roomGone: 'Эта комната уже закрыта. Но играть можно всегда 🌸',
    player: 'Игрок',
    level: (n) => `уровень ${n}`,
    challengeBody: (c) => `${c} зовёт: кто наберёт больше очков? Первая попытка бесплатно.`,
    nobody: 'Пока никто не сыграл — будь первым!',
    challengeEnded: 'Турнир завершён 🏁',
    played: (n, h) => `Сыграли: ${n} · до конца ${h} ч`,
    playedMinutes: (n, m) => `Сыграли: ${n} · до конца ${m} мин`,
    boosted: '⚡ — с бустерами',
    teamBody: (c) => `${c} зовёт весь чат: зажжём фонарь вместе? Каждая партия добавляет огоньки.`,
    teamProgress: (n, t) => `${fmt(n, 'ru-RU')} / ${fmt(t, 'ru-RU')} огоньков`,
    teamNobody: 'Пока никто не зажёг ни огонька — начни первым!',
    teamDone: 'Фонарь зажжён! Сундук получили все участники 🎉',
    teamFailed: 'Время вышло — фонарь не успели зажечь',
    members: (n, h) => `Участников: ${n} · до конца ${h} ч`,
    duelBody: (c) => `${c} вызывает: одна попытка, побеждает тот, кто пройдёт за меньшее число ходов.`,
    duelMoves: (n) => `${n} ходов`,
    duelLost: (s) => `не прошёл (${fmt(s, 'ru-RU')})`,
    duelWaiting: 'Ждём соперника — первый, кто нажмёт «Играть», примет вызов!',
    duelSecond: 'Ждём второго игрока…',
    duelWinner: (n) => `Победил ${n}! 🏆`,
    duelEnded: 'Дуэль закончилась',
    minutesLeft: (n) => `До конца ${n} мин`,
    helpBody: (n) => `🏮 <b>${n} просит жизнь!</b>\nФонарики-сердечки закончились. Нажми кнопку — и жизнь улетит к ${n}.`,
    gifts: (n, max) => `Подарили: ${n}/${max}`,
    giftResult: {
      ok: 'Жизнь отправлена! ❤', already: 'Ты уже дарил жизнь по этой просьбе', full: 'Уже подарили 5 жизней — спасибо!',
      own: 'Себе подарить нельзя 🙂', expired: 'Просьба устарела', not_found: 'Карточка не найдена',
    },
    refreshed: 'Рейтинг обновлён',
  },
  landing: {
    title: 'Турнир на 1 час в Sakura Spark',
    description: (c, l) => `${c} зовёт в турнир: уровень ${l}. Кто наберёт больше очков за час? Первая попытка бесплатно.`,
    game: 'Аниме match-3 в Telegram: фонари, сакура и сотни уровней',
    open: 'Открыть в Telegram',
  },
};

const en: Texts = {
  locale: 'en-US',
  bot: {
    description: 'Sakura Spark — a cozy anime-style match-3. 🌸\n\nThe dark spirit Kurogiri stole Hoshiro’s festival lanterns, and the sakura stopped blooming. '
      + 'Match glowing crystals in threes and more, open the city’s districts and bring the light back with Mika and Pon the tanuki.\n\nPlay right in Telegram — and invite friends to your chats.',
    shortDescription: 'Anime-style match-3: match crystals, light lanterns and bring spring back to Hoshiro 🌸',
    commands: { start: 'Play', paysupport: 'Purchase help', terms: 'Terms', notify: 'Notifications on/off' },
    paysupport: 'Purchase help 🌸\n\nIf a purchase didn’t arrive or something went wrong, write here what happened '
      + 'and send the payment code from your Telegram receipt. We’ll sort it out and refund the Stars if needed.',
    terms: 'Sakura Spark is a free game. Crystals and boosters are virtual items for in-game use only '
      + 'and cannot be exchanged for money. Purchases are paid with Telegram Stars; for disputes — /paysupport.',
    paid: 'Done! Your purchase is in the game 🌸',
    start: (name) => `Hi, ${name}! 🌸\n\nKurogiri stole the festival lanterns, and the sakura in Hoshiro stopped blooming. Help Mika bring the light back — match crystals in threes and more.`,
    play: 'Play',
    notifyOn: 'Notifications are on (no more than two a day). Turn off: /notify off',
    notifyOff: 'Notifications are off. Turn on: /notify on',
    myId: (id) => `Your Telegram id: ${id}`,
    pushFooter: 'Turn off notifications: /notify off',
    friend: 'A friend',
  },
  push: {
    lifeGift: (n) => `${n} sent you a life ❤`,
    askLife: (n) => `${n} asks for a life — send one in the game ❤`,
    askKey: (n) => `${n} asks for a key to a new district — help in the game 🔑`,
    referralJoined: (n, level, c) => `${n} joined via your invite! When they reach level ${level}, you get ${c} 💎`,
    referralReward: (n, level, c) => `${n} reached level ${level} — ${c} 💎 for you!`,
    overtook: (n, level) => `${n} beat your score on level ${level}! Take it back?`,
    livesBack: 'Your lives are full again — Mika is waiting on the map! ❤ ×5',
    raceFirst: (n) => `${n} carried the lantern home first! 2nd and 3rd place are still open`,
    challengeEnded: (place, players, c) => `The tournament is over: you’re #${place} of ${players}. Reward: ${c ? `${c} 💎 and ` : ''}a Shuffle booster`,
    teamLit: 'The team lantern is lit! Chest: 3 💎, a hammer and a rainbow crystal',
    duelWon: 'You won the duel! Reward — a rainbow crystal',
  },
  invoice: {
    pack: (c, bonus) => `${c} star crystals${bonus ? ` (${bonus}% bonus)` : ''}`,
    packTitles: { pack10: 'Handful of crystals', pack50: 'Pouch of crystals', pack100: 'Box of crystals', pack250: 'Chest of crystals', pack500: 'Treasury' },
    starterTitle: 'Starter pack',
    starter: (c, h) => `${c} crystals, 3 boosters and ${h} h of unlimited lives`,
    piggyTitle: 'Crystal piggy bank',
    piggy: (c) => `Break the piggy bank: ${c} crystals`,
    passTitle: 'Festival pass',
    pass: 'Premium pass track: boosters, crystals and frames. A 30-day subscription that renews itself',
  },
  card: {
    challengeTitle: '1-hour tournament',
    challengeDescription: (l) => `Level ${l} · who scores the most in an hour`,
    teamTitle: 'Team lantern',
    teamDescription: (t) => `The whole chat lights ${t} lights together in 48 hours`,
    duelTitle: 'Duel',
    duelDescription: (l) => `Level ${l} · one on one: fewer moves wins, within an hour`,
    helpTitle: 'Ask for a life',
    helpDescription: 'Friends in the chat will send heart lanterns',
    play: '🌸 Play',
    top: '🏆 Ranking',
    gift: '❤ Send a life',
    playGame: '🌸 Play Sakura Spark',
    limitTitle: 'That’s enough cards for today',
    limitText: 'You can send 5 cards a day — new ones tomorrow 🌸',
    roomStart: (c, l) => `${c} invites you to a 1-hour tournament: level ${l}. Everyone gets the same board — who scores the most? The first try is free.`,
    teamStart: (c) => `${c} is lighting the team lantern: every game you play adds lights. Reach the goal — a chest for everyone who helped.`,
    duelStart: (c, l) => `${c} challenges you to a duel: level ${l}, one try. Whoever clears it in fewer moves wins.`,
    roomGone: 'This room is already closed. But you can always play 🌸',
    player: 'Player',
    level: (n) => `level ${n}`,
    challengeBody: (c) => `${c} asks: who scores the most? The first try is free.`,
    nobody: 'Nobody has played yet — be the first!',
    challengeEnded: 'The tournament is over 🏁',
    played: (n, h) => `Played: ${n} · ${h} h left`,
    playedMinutes: (n, m) => `Played: ${n} · ${m} min left`,
    boosted: '⚡ — with boosters',
    teamBody: (c) => `${c} invites the whole chat: shall we light the lantern together? Every game adds lights.`,
    teamProgress: (n, t) => `${fmt(n, 'en-US')} / ${fmt(t, 'en-US')} lights`,
    teamNobody: 'No lights yet — be the first!',
    teamDone: 'The lantern is lit! Everyone got a chest 🎉',
    teamFailed: 'Time’s up — the lantern wasn’t lit',
    members: (n, h) => `Players: ${n} · ${h} h left`,
    duelBody: (c) => `${c} challenges: one try, fewer moves wins.`,
    duelMoves: (n) => `${n} moves`,
    duelLost: (s) => `did not clear (${fmt(s, 'en-US')})`,
    duelWaiting: 'Waiting for a rival — the first to press “Play” accepts!',
    duelSecond: 'Waiting for the second player…',
    duelWinner: (n) => `${n} wins! 🏆`,
    duelEnded: 'The duel is over',
    minutesLeft: (n) => `${n} min left`,
    helpBody: (n) => `🏮 <b>${n} asks for a life!</b>\nOut of heart lanterns. Press the button — and a life flies to ${n}.`,
    gifts: (n, max) => `Sent: ${n}/${max}`,
    giftResult: {
      ok: 'Life sent! ❤', already: 'You already sent a life for this request', full: '5 lives already sent — thank you!',
      own: 'You can’t send one to yourself 🙂', expired: 'This request has expired', not_found: 'Card not found',
    },
    refreshed: 'Ranking updated',
  },
  landing: {
    title: '1-hour tournament in Sakura Spark',
    description: (c, l) => `${c} invites you to a tournament: level ${l}. Who scores the most in an hour? The first try is free.`,
    game: 'An anime match-3 in Telegram: lanterns, sakura and hundreds of levels',
    open: 'Open in Telegram',
  },
};

const es: Texts = {
  locale: 'es-ES',
  bot: {
    description: 'Sakura Spark — un acogedor match-3 de estilo anime. 🌸\n\nEl espíritu oscuro Kurogiri robó los farolillos del festival de Hoshiro y el sakura dejó de florecer. '
      + 'Junta cristales brillantes de tres en tres o más, abre los distritos de la ciudad y devuelve la luz con Mika y el tanuki Pon.\n\nJuega dentro de Telegram — e invita a tus amigos a los chats.',
    shortDescription: 'Match-3 de estilo anime: junta cristales, enciende farolillos y devuelve la primavera a Hoshiro 🌸',
    commands: { start: 'Jugar', paysupport: 'Ayuda con compras', terms: 'Condiciones', notify: 'Notificaciones sí/no' },
    paysupport: 'Ayuda con compras 🌸\n\nSi una compra no llegó o algo salió mal, escribe aquí qué pasó '
      + 'y envía el código de pago del recibo de Telegram. Lo revisaremos y, si hace falta, devolveremos las Stars.',
    terms: 'Sakura Spark es un juego gratuito. Los cristales y potenciadores son objetos virtuales solo para usar en el juego '
      + 'y no se cambian por dinero. Las compras se pagan con Telegram Stars; para reclamaciones — /paysupport.',
    paid: '¡Listo! Tu compra ya está en el juego 🌸',
    start: (name) => `¡Hola, ${name}! 🌸\n\nKurogiri robó los farolillos del festival y el sakura de Hoshiro dejó de florecer. Ayuda a Mika a recuperar la luz — junta cristales de tres en tres o más.`,
    play: 'Jugar',
    notifyOn: 'Notificaciones activadas (no más de dos al día). Desactivar: /notify off',
    notifyOff: 'Notificaciones desactivadas. Activar: /notify on',
    myId: (id) => `Tu id de Telegram: ${id}`,
    pushFooter: 'Desactivar notificaciones: /notify off',
    friend: 'Un amigo',
  },
  push: {
    lifeGift: (n) => `${n} te regaló una vida ❤`,
    askLife: (n) => `${n} pide una vida — regálasela en el juego ❤`,
    askKey: (n) => `${n} pide una llave para un nuevo distrito — ayúdale en el juego 🔑`,
    referralJoined: (n, level, c) => `¡${n} llegó con tu invitación! Cuando alcance el nivel ${level}, recibirás ${c} 💎`,
    referralReward: (n, level, c) => `¡${n} llegó al nivel ${level} — ${c} 💎 para ti!`,
    overtook: (n, level) => `¡${n} te superó en el nivel ${level}! ¿La revancha?`,
    livesBack: '¡Tus vidas están llenas — Mika te espera en el mapa! ❤ ×5',
    raceFirst: (n) => `¡${n} llevó el farolillo el primero! Aún quedan el 2.º y el 3.er puesto`,
    challengeEnded: (place, players, c) => `El torneo terminó: quedaste n.º ${place} de ${players}. Recompensa: ${c ? `${c} 💎 y ` : ''}un potenciador Mezclar`,
    teamLit: '¡El farolillo de equipo está encendido! Cofre: 3 💎, un martillo y un cristal arcoíris',
    duelWon: '¡Ganaste el duelo! Recompensa: un cristal arcoíris',
  },
  invoice: {
    pack: (c, bonus) => `${c} cristales estelares${bonus ? ` (${bonus}% extra)` : ''}`,
    packTitles: { pack10: 'Puñado de cristales', pack50: 'Bolsita de cristales', pack100: 'Cajita de cristales', pack250: 'Cofre de cristales', pack500: 'Tesoro' },
    starterTitle: 'Pack de inicio',
    starter: (c, h) => `${c} cristales, 3 potenciadores y ${h} h de vidas infinitas`,
    piggyTitle: 'Hucha de cristales',
    piggy: (c) => `Romper la hucha: ${c} cristales`,
    passTitle: 'Pase del festival',
    pass: 'Vía premium del pase: potenciadores, cristales y marcos. Suscripción de 30 días que se renueva sola',
  },
  card: {
    challengeTitle: 'Torneo de 1 hora',
    challengeDescription: (l) => `Nivel ${l} · quién hace más puntos en una hora`,
    teamTitle: 'Farolillo de equipo',
    teamDescription: (t) => `Todo el chat enciende ${t} lucecitas juntos en 48 horas`,
    duelTitle: 'Duelo',
    duelDescription: (l) => `Nivel ${l} · uno contra uno: gana quien use menos movimientos, en una hora`,
    helpTitle: 'Pedir una vida',
    helpDescription: 'Tus amigos del chat te regalarán farolillos-corazón',
    play: '🌸 Jugar',
    top: '🏆 Clasificación',
    gift: '❤ Regalar vida',
    playGame: '🌸 Jugar a Sakura Spark',
    limitTitle: 'Suficientes tarjetas por hoy',
    limitText: 'Puedes enviar 5 tarjetas al día — mañana habrá más 🌸',
    roomStart: (c, l) => `${c} te invita a un torneo de 1 hora: nivel ${l}. Todos tienen el mismo tablero — ¿quién hace más puntos? El primer intento es gratis.`,
    teamStart: (c) => `${c} enciende el farolillo de equipo: cada partida tuya suma lucecitas. Meta cumplida — un cofre para todos los que ayudaron.`,
    duelStart: (c, l) => `${c} te reta a un duelo: nivel ${l}, un intento. Gana quien lo supere con menos movimientos.`,
    roomGone: 'Esta sala ya está cerrada. Pero siempre puedes jugar 🌸',
    player: 'Jugador',
    level: (n) => `nivel ${n}`,
    challengeBody: (c) => `${c} pregunta: ¿quién hace más puntos? El primer intento es gratis.`,
    nobody: 'Nadie ha jugado aún — ¡sé el primero!',
    challengeEnded: 'El torneo terminó 🏁',
    played: (n, h) => `Han jugado: ${n} · quedan ${h} h`,
    playedMinutes: (n, m) => `Han jugado: ${n} · quedan ${m} min`,
    boosted: '⚡ — con potenciadores',
    teamBody: (c) => `${c} invita a todo el chat: ¿encendemos el farolillo juntos? Cada partida suma lucecitas.`,
    teamProgress: (n, t) => `${fmt(n, 'es-ES')} / ${fmt(t, 'es-ES')} lucecitas`,
    teamNobody: 'Aún no hay lucecitas — ¡empieza tú!',
    teamDone: '¡El farolillo está encendido! Todos recibieron un cofre 🎉',
    teamFailed: 'Se acabó el tiempo — no se encendió el farolillo',
    members: (n, h) => `Participantes: ${n} · quedan ${h} h`,
    duelBody: (c) => `${c} reta: un intento, gana quien use menos movimientos.`,
    duelMoves: (n) => `${n} movimientos`,
    duelLost: (s) => `no lo superó (${fmt(s, 'es-ES')})`,
    duelWaiting: 'Esperando rival — ¡el primero que pulse «Jugar» acepta el reto!',
    duelSecond: 'Esperando al segundo jugador…',
    duelWinner: (n) => `¡Gana ${n}! 🏆`,
    duelEnded: 'El duelo terminó',
    minutesLeft: (n) => `Quedan ${n} min`,
    helpBody: (n) => `🏮 <b>¡${n} pide una vida!</b>\nSe acabaron los farolillos-corazón. Pulsa el botón — y una vida volará hacia ${n}.`,
    gifts: (n, max) => `Regaladas: ${n}/${max}`,
    giftResult: {
      ok: '¡Vida enviada! ❤', already: 'Ya regalaste una vida para esta petición', full: 'Ya se regalaron 5 vidas — ¡gracias!',
      own: 'No puedes regalarte a ti mismo 🙂', expired: 'La petición ha caducado', not_found: 'Tarjeta no encontrada',
    },
    refreshed: 'Clasificación actualizada',
  },
  landing: {
    title: 'Torneo de 1 hora en Sakura Spark',
    description: (c, l) => `${c} te invita a un torneo: nivel ${l}. ¿Quién hace más puntos en una hora? El primer intento es gratis.`,
    game: 'Un match-3 anime en Telegram: farolillos, sakura y cientos de niveles',
    open: 'Abrir en Telegram',
  },
};

const pt: Texts = {
  locale: 'pt-BR',
  bot: {
    description: 'Sakura Spark — um match-3 aconchegante em estilo anime. 🌸\n\nO espírito sombrio Kurogiri roubou as lanternas do festival de Hoshiro, e a sakura parou de florescer. '
      + 'Junte cristais brilhantes de três em três ou mais, abra os distritos da cidade e traga a luz de volta com a Mika e o tanuki Pon.\n\nJogue dentro do Telegram — e chame os amigos nos chats.',
    shortDescription: 'Match-3 em estilo anime: junte cristais, acenda lanternas e traga a primavera de volta a Hoshiro 🌸',
    commands: { start: 'Jogar', paysupport: 'Ajuda com compras', terms: 'Termos', notify: 'Notificações liga/desliga' },
    paysupport: 'Ajuda com compras 🌸\n\nSe uma compra não chegou ou algo deu errado, escreva aqui o que aconteceu '
      + 'e mande o código de pagamento do recibo do Telegram. Vamos verificar e, se preciso, devolver as Stars.',
    terms: 'Sakura Spark é um jogo gratuito. Cristais e reforços são itens virtuais só para uso no jogo '
      + 'e não são trocados por dinheiro. As compras são pagas com Telegram Stars; em caso de disputa — /paysupport.',
    paid: 'Pronto! Sua compra já está no jogo 🌸',
    start: (name) => `Oi, ${name}! 🌸\n\nKurogiri roubou as lanternas do festival, e a sakura de Hoshiro parou de florescer. Ajude a Mika a trazer a luz de volta — junte cristais de três em três ou mais.`,
    play: 'Jogar',
    notifyOn: 'Notificações ligadas (no máximo duas por dia). Desligar: /notify off',
    notifyOff: 'Notificações desligadas. Ligar: /notify on',
    myId: (id) => `Seu id do Telegram: ${id}`,
    pushFooter: 'Desligar notificações: /notify off',
    friend: 'Um amigo',
  },
  push: {
    lifeGift: (n) => `${n} te deu uma vida ❤`,
    askLife: (n) => `${n} pede uma vida — mande no jogo ❤`,
    askKey: (n) => `${n} pede uma chave para um novo distrito — ajude no jogo 🔑`,
    referralJoined: (n, level, c) => `${n} entrou pelo seu convite! Quando chegar ao nível ${level}, você ganha ${c} 💎`,
    referralReward: (n, level, c) => `${n} chegou ao nível ${level} — ${c} 💎 para você!`,
    overtook: (n, level) => `${n} passou você no nível ${level}! Vai dar o troco?`,
    livesBack: 'Suas vidas estão cheias — a Mika te espera no mapa! ❤ ×5',
    raceFirst: (n) => `${n} levou a lanterna primeiro! Ainda dá para ficar em 2.º e 3.º`,
    challengeEnded: (place, players, c) => `O torneio terminou: você ficou em ${place}.º de ${players}. Recompensa: ${c ? `${c} 💎 e ` : ''}um reforço Embaralhar`,
    teamLit: 'A lanterna da equipe está acesa! Baú: 3 💎, um martelo e um cristal arco-íris',
    duelWon: 'Você venceu o duelo! Recompensa: um cristal arco-íris',
  },
  invoice: {
    pack: (c, bonus) => `${c} cristais estelares${bonus ? ` (${bonus}% de bônus)` : ''}`,
    packTitles: { pack10: 'Punhado de cristais', pack50: 'Saquinho de cristais', pack100: 'Caixinha de cristais', pack250: 'Baú de cristais', pack500: 'Tesouro' },
    starterTitle: 'Pacote inicial',
    starter: (c, h) => `${c} cristais, 3 reforços e ${h} h de vidas infinitas`,
    piggyTitle: 'Cofrinho de cristais',
    piggy: (c) => `Quebrar o cofrinho: ${c} cristais`,
    passTitle: 'Passe do festival',
    pass: 'Trilha premium do passe: reforços, cristais e molduras. Assinatura de 30 dias que se renova sozinha',
  },
  card: {
    challengeTitle: 'Torneio de 1 hora',
    challengeDescription: (l) => `Nível ${l} · quem faz mais pontos em uma hora`,
    teamTitle: 'Lanterna da equipe',
    teamDescription: (t) => `O chat inteiro acende ${t} luzinhas juntos em 48 horas`,
    duelTitle: 'Duelo',
    duelDescription: (l) => `Nível ${l} · um contra um: vence quem usar menos jogadas, em uma hora`,
    helpTitle: 'Pedir uma vida',
    helpDescription: 'Os amigos do chat vão mandar lanternas-coração',
    play: '🌸 Jogar',
    top: '🏆 Ranking',
    gift: '❤ Dar uma vida',
    playGame: '🌸 Jogar Sakura Spark',
    limitTitle: 'Chega de cartões por hoje',
    limitText: 'Dá para mandar 5 cartões por dia — amanhã tem mais 🌸',
    roomStart: (c, l) => `${c} te chama para um torneio de 1 hora: nível ${l}. Todos têm o mesmo tabuleiro — quem faz mais pontos? A primeira tentativa é grátis.`,
    teamStart: (c) => `${c} está acendendo a lanterna da equipe: cada partida sua soma luzinhas. Meta batida — um baú para todos que ajudaram.`,
    duelStart: (c, l) => `${c} te desafia para um duelo: nível ${l}, uma tentativa. Vence quem passar com menos jogadas.`,
    roomGone: 'Esta sala já está fechada. Mas você sempre pode jogar 🌸',
    player: 'Jogador',
    level: (n) => `nível ${n}`,
    challengeBody: (c) => `${c} pergunta: quem faz mais pontos? A primeira tentativa é grátis.`,
    nobody: 'Ninguém jogou ainda — seja o primeiro!',
    challengeEnded: 'O torneio terminou 🏁',
    played: (n, h) => `Jogaram: ${n} · faltam ${h} h`,
    playedMinutes: (n, m) => `Jogaram: ${n} · faltam ${m} min`,
    boosted: '⚡ — com reforços',
    teamBody: (c) => `${c} chama o chat inteiro: vamos acender a lanterna juntos? Cada partida soma luzinhas.`,
    teamProgress: (n, t) => `${fmt(n, 'pt-BR')} / ${fmt(t, 'pt-BR')} luzinhas`,
    teamNobody: 'Nenhuma luzinha ainda — comece você!',
    teamDone: 'A lanterna está acesa! Todos ganharam um baú 🎉',
    teamFailed: 'O tempo acabou — a lanterna não foi acesa',
    members: (n, h) => `Participantes: ${n} · faltam ${h} h`,
    duelBody: (c) => `${c} desafia: uma tentativa, vence quem usar menos jogadas.`,
    duelMoves: (n) => `${n} jogadas`,
    duelLost: (s) => `não passou (${fmt(s, 'pt-BR')})`,
    duelWaiting: 'Esperando um rival — o primeiro a tocar em “Jogar” aceita o desafio!',
    duelSecond: 'Esperando o segundo jogador…',
    duelWinner: (n) => `${n} venceu! 🏆`,
    duelEnded: 'O duelo terminou',
    minutesLeft: (n) => `Faltam ${n} min`,
    helpBody: (n) => `🏮 <b>${n} pede uma vida!</b>\nAs lanternas-coração acabaram. Toque no botão — e uma vida voa até ${n}.`,
    gifts: (n, max) => `Enviadas: ${n}/${max}`,
    giftResult: {
      ok: 'Vida enviada! ❤', already: 'Você já deu uma vida para este pedido', full: 'Já deram 5 vidas — obrigado!',
      own: 'Não dá para dar a si mesmo 🙂', expired: 'O pedido expirou', not_found: 'Cartão não encontrado',
    },
    refreshed: 'Ranking atualizado',
  },
  landing: {
    title: 'Torneio de 1 hora no Sakura Spark',
    description: (c, l) => `${c} te chama para um torneio: nível ${l}. Quem faz mais pontos em uma hora? A primeira tentativa é grátis.`,
    game: 'Um match-3 anime no Telegram: lanternas, sakura e centenas de níveis',
    open: 'Abrir no Telegram',
  },
};

export const TEXTS: Readonly<Record<Lang, Texts>> = { ru, en, es, pt };
export const textsFor = (code: string | null | undefined): Texts => TEXTS[langOf(code)];
