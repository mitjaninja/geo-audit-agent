# Sakura Spark

Match-3 в аниме-стиле для Telegram Mini App. Требования — [PRD.md](PRD.md), этапы — [ROADMAP.md](ROADMAP.md).

## Структура

- `packages/core` — правила match-3 без движка: детерминированный RNG, поле, матчи (включая L/T), каскады, гравитация, досыпка, перемешивание, очки, ходы, реплей.
  Спецфишки и комбо — в `src/specials.ts`, правила описаны в комментариях к `Special` и `ComboKind` в `src/types.ts`.
  Цели и звёзды — `src/goals.ts`, блокеры и порталы — `src/blockers.ts`, формат и валидатор уровня — `src/level.ts`.
- `packages/sim` — боты (случайный и жадный) и автотест уровней против коридоров win rate из PRD.
- `levels/` — уровни в JSON, имя файла = id с нулями (`0001.json`). Тест проверяет каждый файл.

## Формат уровня

```jsonc
{
  "id": 2, "width": 8, "height": 8, "colors": 5, "moves": 25,
  "difficulty": "normal",              // normal | hard | superHard
  "shape": ["_######_", "..."],         // # клетка, _ дыра (необязательно)
  "jelly": ["_000000_", "..."],         // слои желе 0–2 (необязательно)
  "blockers": [".iI.v...", "..."],     // . нет, i/I лёд, f туман, k/K сундук, m/M дайфуку, v лианы
  "portals": [{ "from": [2, 3], "to": [4, 4] }],
  "lanterns": { "total": 2, "maxOnBoard": 2, "spawnChance": 0.3 },
  "goals": [                            // 1–3 цели, нужны все
    { "type": "score", "target": 1500 },
    { "type": "jelly" },
    { "type": "lanterns", "count": 2 },
    { "type": "collect", "color": 1, "count": 20 },
    { "type": "fog" }
  ],
  "stars": [1500, 3000, 5000]           // пороги очков; победа = минимум 1 звезда
}
```

Правила блокеров — в комментарии к `Blocker` в `src/blockers.ts`. Фишки пролетают сквозь
блокеры и дыры; в выход портала сверху ничего не падает — только из входа.

Сид поля в уровень не входит: сервер выдаёт его на каждую попытку (`gameOptionsFromLevel(level, seed)`).

## Команды

```bash
npm install
npm run typecheck
npm test
npm run autotest -- --runs 1000            # все уровни, жадный бот
npm run autotest -- levels/0003.json --bot random --runs 300 --json report.json
```

Автотест печатает win rate с 95% интервалом, целевой коридор PRD и вердикт (`ok` / `TOO HARD` / `TOO EASY`),
распределение звёзд, средний остаток ходов при победе и долю «почти побед» (проигрыш при прогрессе целей ≥ 80% —
кандидаты на окно «+5 ходов»). `--assist 0.04` — проверить, как помогает скрытое облегчение. `--strict` — код
выхода 1 при выходе из коридора (для CI).

Жадный бот примеряет каждый ход на копии партии с чужим сидом, поэтому не видит будущую досыпку.
Он играет заметно сильнее случайного; соотношение «бот ↔ живые игроки» нужно откалибровать по данным софт-лонча.

## Пример

```ts
import { Match3Game } from '@sakura/core';

const game = new Match3Game({ width: 9, height: 9, colors: 5, moves: 25, seed: 42 });
const { valid, events } = game.swap({ a: { row: 4, col: 4 }, b: { row: 4, col: 5 } });
// events: swap → cascade × N → (shuffle) — клиент проигрывает их как анимации

// на сервере: тот же сид + история ходов = тот же счёт
Match3Game.replay(game.options, game.history).score === game.score;
```
