# Sakura Spark

Match-3 в аниме-стиле для Telegram Mini App. Требования — [PRD.md](PRD.md), этапы — [ROADMAP.md](ROADMAP.md).

## Структура

- `packages/core` — правила match-3 без движка: детерминированный RNG, поле, матчи (включая L/T), каскады, гравитация, досыпка, перемешивание, очки, ходы, реплей.
  Спецфишки и комбо — в `src/specials.ts`, правила описаны в комментариях к `Special` и `ComboKind` в `src/types.ts`.

## Команды

```bash
npm install
npm run typecheck
npm test
```

## Пример

```ts
import { Match3Game } from '@sakura/core';

const game = new Match3Game({ width: 9, height: 9, colors: 5, moves: 25, seed: 42 });
const { valid, events } = game.swap({ a: { row: 4, col: 4 }, b: { row: 4, col: 5 } });
// events: swap → cascade × N → (shuffle) — клиент проигрывает их как анимации

// на сервере: тот же сид + история ходов = тот же счёт
Match3Game.replay(game.options, game.history).score === game.score;
```
