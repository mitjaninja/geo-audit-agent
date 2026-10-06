# GEO Audit Agent — технический спек для Claude Code

Oct 6, 2026 · @Dmitry

Агент-продавец для Virtuals ACP, который за USDC делает GEO-аудит бренда, токена или продукта: спрашивает ChatGPT, Claude, Perplexity и Gemini и возвращает проверяемый JSON-отчёт. Спек рассчитан на сборку в Claude Code за 7 этапов, каждый заканчивается зелёными тестами.

## Как работать со спеком в Claude Code

1. Создать пустой репозиторий `geo-audit-agent`, экспортировать этот документ в Markdown и положить как `SPEC.md` в корень.
2. Создать `CLAUDE.md` с текстом из блока ниже — Claude Code читает его в каждой сессии.
3. Идти по этапам из раздела «План этапов»: один этап — одна сессия. Начинать сессию в plan mode, утверждать план, потом давать писать код.
4. После каждого этапа: `npm run typecheck && npm test`, коммит. Следующий этап не начинать на красных тестах.
5. Если есть референсная реализация (архив `geo-audit-agent.zip` из прошлого шага), положить её в `reference/` и разрешить сверяться, но не копировать вслепую.

```markdown
# CLAUDE.md

Проект: GEO Audit Agent — продавец GEO-аудитов в Virtuals ACP. Источник истины — SPEC.md.

## Правила
- Node 20+, TypeScript strict, ESM (NodeNext). Зависимости только: ajv, dotenv; dev: tsx, typescript, @types/node.
- HTTP к LLM — через встроенный fetch, без SDK провайдеров.
- Каждый модуль с логикой покрыт тестами в test/ (node:test). Сеть в тестах запрещена: MOCK_ENGINES=1 и фейковый AcpPort.
- Контракты из SPEC.md (схема requirements, формат отчёта, формула скора) меняются только вместе со SPEC.md.
- Метрики (упоминание, позиция, цитаты) считаются детерминированно. LLM-судья — только тональность, факты, конкуренты.
- Тексты отчёта на английском. README и комментарии к решениям — на русском.
- Перед завершением задачи: npm run typecheck && npm test.

## Команды
- npm test · npm run typecheck · npm run audit -- --request examples/brand.json · npm run serve
```

## Цель, скоуп и не-цели

Цель MVP — агент, который без участия человека принимает сделку в ACP, выполняет аудит и сдаёт отчёт, который оценщик может принять.

**В скоупе:**

- Два оффера: **GEO Audit Quick** (3 USDC, SLA 30 мин) и **GEO Audit Full** (15 USDC, SLA 60 мин). Цены и названия — в `.env`.
- Объекты аудита: `brand`, `token`, `product`, `protocol`, `person`. Языки проверки: `en`, `ru`.
- Движки: ChatGPT (OpenAI), Claude (Anthropic), Perplexity, Gemini. Каждый включается, если задан его ключ.
- Отчёт: GEO-скор 0–100, разбивка по движкам и типам запросов, доля голоса, проблемы, рекомендации с доказательствами, полный список ответов.
- Рантайм продавца поверх `acp-cli`: ставит бюджет, ждёт оплаты, сдаёт результат, переживает перезапуск.
- Локальный CLI для аудита вне ACP.

**Не в MVP:**

- PDF и веб-интерфейс (JSON + Markdown-сводка достаточно для агентов-покупателей).
- YandexGPT, GigaChat, Copilot и прочие движки — добавляются позже одной функцией.
- Подписки и мониторинг динамики во времени.
- Свой оценщик (evaluator) и выпуск токена агента.
- Выполнение рекомендаций (агент только аудирует).

**Метрики успеха:** первая сделка в ACP Sandbox закрыта статусом `completed`; себестоимость Quick ≤ 20% цены; 0 сделок, сданных пустым или битым JSON.

## Контекст ACP

Продавец работает через официальный `@virtuals-protocol/acp-cli` (v2); старый `openclaw-acp` с `handlers.ts` закрыт в июне 2026 и не используется. Сделка идёт по цепочке `open → budget_set → funded → submitted → completed`, с ветками `rejected` и `expired`.

| Шаг | Кто | Событие в потоке | Команда продавца |
| --- | --- | --- | --- |
| 1. Клиент создаёт сделку из оффера | клиент | `job.created` + сообщение `contentType: "requirement"` | — |
| 2. Продавец проверяет запрос и ставит цену | продавец | `budget.set` | `acp provider set-budget --job-id <id> --amount <usdc> --chain-id <chain> --json` |
| 3. Клиент кладёт USDC в эскроу | клиент | `job.funded` (`amount`) | — |
| 4. Продавец делает аудит и сдаёт отчёт | продавец | `job.submitted` | `acp provider submit --job-id <id> --deliverable '<json>' --chain-id <chain> --json` |
| 5. Оценщик принимает или отклоняет | оценщик / клиент | `job.completed` / `job.rejected` (`reason`) | — |
| — Срок SLA вышел | — | `job.expired` | — |

**Источники данных для рантайма:**

- `acp events listen --json` — долгоживущий процесс, NDJSON. Строка: `{jobId, chainId, status, roles[], availableTools[], entry}`. `entry.kind` = `"system"` (поле `event.type` из таблицы) или `"message"` (`from`, `contentType`, `content`).
- Требование клиента приходит первым сообщением с `contentType: "requirement"`, `content` — JSON-строка.
- Какой оффер купили: в v2 описание сделки равно имени оффера. Читать через `acp job list --json` → `jobs[].description` по `onChainJobId` и `chainId`.
- Восстановление после простоя: `acp job list --json` (активные сделки) и `acp job history --job-id --chain-id --json` (`entries[]`, в том числе requirement).
- Прочее: `acp message send` — сообщение клиенту; `acp offering create` — регистрация оффера, `--requirements` принимает JSON Schema, и клиентский SDK валидирует запрос по ней до создания сделки.

**Ограничения:** deliverable передаётся аргументом командной строки — держать ≤ 60 КБ (лимит одного аргумента в Linux — 128 КБ). Сумма в `job.funded` может прийти в USDC или в базовых единицах (6 знаков) — нормализовать.

## Архитектура и структура репозитория

Рантайм — единственное место, которое знает про ACP; конвейер аудита про ACP не знает и вызывается так же из локального CLI.

&#91;embedded content: архитектура · ACP-слой, рантайм, конвейер аудита\]

Рантайм получает события через acp-cli, ставит бюджет и после оплаты отдаёт запрос в конвейер; готовый отчёт уходит обратно через `provider submit`.

```text
geo-audit-agent/
├── CLAUDE.md, SPEC.md, README.md
├── package.json, tsconfig.json, .env.example, .gitignore
├── offering/
│   ├── requirements.schema.json   # вход, публикуется в ACP
│   ├── deliverable.md             # описание выхода для оффера
│   └── register-offerings.sh      # acp offering create × 2
├── examples/                      # token.json, brand.json
├── src/
│   ├── types.ts      config.ts    validate.ts
│   ├── queries.ts    engines.ts   analyze.ts
│   ├── scoring.ts    recommend.ts audit.ts   deliverable.ts
│   ├── acp.ts        runtime.ts
│   └── cli.ts        serve.ts     # точки входа
├── test/                          # engine.test.ts, runtime.test.ts
└── data/                          # jobs.json, reports/ (в .gitignore)
```

## Контракты данных

Два внешних контракта — вход (requirements) и выход (deliverable) — публикуются в ACP и не меняются без версии `schemaVersion`. Внутренние типы живут в `src/types.ts`.

### Requirements — `offering/requirements.schema.json`

Одна схема на оба оффера (тариф определяется оффером, не полем). `additionalProperties: false`. Обязательны `subject`, `subjectType`, `category`.

| Поле | Тип и ограничения | Зачем |
| --- | --- | --- |
| `subject` | string, 2–80 | Название объекта |
| `subjectType` | `brand` · `token` · `product` · `protocol` · `person` | Выбор шаблонов вопросов |
| `category` | string, 2–120 | Подставляется в discovery-вопросы («best {category}») |
| `aliases` | string\[\] ≤ 8 | Другие написания, тикеры; `$TICKER` также матчит `TICKER` |
| `domains` | string\[\] ≤ 8 | Свои домены для метрики цитирования, поддомены засчитываются |
| `competitors` | string\[\] ≤ 6 | Для доли голоса и сравнительных вопросов; без них конкурентов извлекает судья |
| `facts` | string\[\] ≤ 10, каждый 3–200 | Канонические факты для проверки искажений |
| `contractAddress` | string ≤ 100 | Только для токенов, отдельный trust-вопрос |
| `languages` | (`en` · `ru`)\[\] 1–2, default `["en"]` | Языки проверки |
| `customQueries` | string\[\] ≤ 10, каждый 5–200 | Свои вопросы; язык определяется по кириллице |

Парсер принимает и обёртки `{requirement: {...}}` / `{serviceRequirement: {...}}`, применяет default-значения (ajv `useDefaults`).

### Deliverable — JSON-строка, `schemaVersion: "1.0"`

```ts
interface ScoreBreakdown {
  geoScore: number;          // 0–100, целое
  visibility: number;        // доля ответов с упоминанием, 0–1, 3 знака
  organicVisibility: number; // то же, только discovery-вопросы
  avgRank: number | null;    // средняя позиция в списках, 2 знака
  positiveShare: number;     // среди ответов с упоминанием
  negativeShare: number;
  accuracy: number;          // доля ответов с упоминанием без искажений
  citationShare: number;     // доля поисковых ответов со ссылкой на свои домены
  answers: number;           // успешные ответы
  failed: number;            // ошибки движков
}

interface AuditReport {
  schemaVersion: "1.0";
  reportId: string;          // uuid
  generatedAt: string;       // ISO
  tier: "quick" | "full";
  subject: { subject: string; subjectType: string; category: string };
  method: { engines: { engine: string; model: string; search: boolean }[]; languages: ("en" | "ru")[]; probes: number; scoring: string };
  scores: { overall: ScoreBreakdown; byEngine: Record<string, ScoreBreakdown>; byIntent: Record<string, ScoreBreakdown> };
  shareOfVoice: { name: string; mentions: number; share: number }[];   // по discovery-ответам, топ-12
  issues: {
    contradictedFacts: { fact: string; engine: string; query: string }[];
    suspectClaims: { claim: string; engine: string; query: string }[];
    negativeAnswers: { engine: string; query: string; excerpt: string }[];
  };
  topCitedDomains: { domain: string; count: number }[];               // топ-15
  recommendations: {
    id: string; priority: "high" | "medium" | "low";
    area: "visibility" | "accuracy" | "sentiment" | "citations" | "competition" | "token";
    title: string; why: string; actions: string[]; evidence: string[];   // evidence непустой всегда
  }[];
  evidence: { engine: string; intent: string; lang: string; query: string; mentioned: boolean | null;
              rank: number | null; sentiment: string | null; excerpt: string; citations: string[] }[];
  summaryMarkdown: string;
  fullReportUrl?: string;      // если задан PUBLIC_REPORT_BASE_URL
  evidenceTruncated?: boolean; // если evidence урезан под лимит
}
```

**Инварианты, которые проверяют тесты и может проверить оценщик:** `evidence.length == method.probes` (если не урезан); `scores.overall.visibility` пересчитывается из `evidence`; у каждой рекомендации есть `actions` и `evidence`; `subject` совпадает с запросом; `excerpt` ≤ 240 символов вокруг первого упоминания.

## Модули

Семь модулей с логикой и три тонких точки входа. Ниже — что каждый обязан делать; детали реализации на усмотрение Claude Code, если не нарушают контракты.

### `queries.ts` — набор вопросов

- `buildProbes(req, tier): Probe[]`, где `Probe = {id, intent, lang, query, namesSubject}`.
- Интенты: `discovery` (бренд не назван — главная метрика), `direct`, `comparison`, `trust`, `action`, `custom`.
- Шаблоны на `en` и `ru`, около 16 на язык. Плейсхолдеры `{s}` объект, `{c}` категория, `{comp}` первый конкурент, `{ca}` контракт. Шаблон с `types` применяется только к этим типам объекта. Шаблон с `{comp}` / `{ca}` пропускается, если поля нет.
- Формулировки — как спрашивают живые люди («What are the best {c} right now?», «{s} — это надёжно или скам?»), не SEO-ключи.
- Quick: до 6 вопросов на язык — 2 discovery + по одному `direct`, `trust`, `comparison`, `action`. Full: до 16 на язык. `customQueries` добавляются в любом тарифе.

### `engines.ts` — опрос движков

- Интерфейс `Engine {name, model, search, ask(prompt): Promise<EngineAnswer>}`; `EngineAnswer = {engine, model, text, citations[], latencyMs, error?}`. Ошибка не бросается, а возвращается в `error`.
- Общий system-промпт: «ответь как обычно, на языке вопроса». Таймаут через AbortController.

| Движок | Endpoint | Поиск | Где цитаты |
| --- | --- | --- | --- |
| chatgpt | `api.openai.com/v1/chat/completions`; при `OPENAI_WEB_SEARCH=1` — `/v1/responses` с tool `web_search` | опционально | `output[].content[].annotations[].url` |
| claude | `api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`; при `ANTHROPIC_WEB_SEARCH=1` — tool `web_search_20250305` | опционально | `content[].citations[].url` |
| perplexity | `api.perplexity.ai/chat/completions`, модель `sonar` | всегда | `citations[]` и `search_results[].url` |
| gemini | `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, tool `google_search` | всегда | `groundingMetadata.groundingChunks[].web` (uri — редирект, домен брать из `title`) |

- `mockEngines(subject, competitors)` — детерминированные фейки (хеш FNV от имени движка и вопроса): нумерованный список конкурентов, объект вставляется по смещению; часть ответов с «risks»; у поисковых — фиктивные цитаты.
- `judgeComplete(prompt)` — вызов судьи (Anthropic по умолчанию, OpenAI при `JUDGE_ENGINE=openai`), `temperature: 0`.

### `analyze.ts` — разбор ответа

Детерминированная часть (без LLM), обязательна:

- `names(req)` = subject + aliases; для `$TICKER` добавляется `TICKER`.
- Упоминание — регулярка с Unicode-границами `(^|[^\p{L}\p{N}])(name)(?=$|[^\p{L}\p{N}])`, флаги `iu`. «VIRTUALLY» не матчит «VIRTUAL», «Альфабанк» не матчит «Альфа».
- `rank` — позиция первого пункта нумерованного или маркированного списка (≥ 2 пунктов), где есть объект; иначе `null`.
- `citedDomains` — домены из цитат без `www.`; `ownDomainCited` — совпадение с `domains` или их поддоменом.
- `competitorsMentioned` — из `req.competitors`, найденные той же регуляркой.

Судья (если объект упомянут или конкуренты не заданы): возвращает JSON `{sentiment, contradictedFacts, suspectClaims, competitors}`. `contradictedFacts` фильтруются — только дословные строки из `req.facts`; `suspectClaims` ≤ 3; объект исключается из конкурентов. Сбой судьи не роняет аудит — остаётся детерминированная часть.

### `scoring.ts` — GEO-скор

```latex
GEO = 100 \cdot \frac{0.40\,V + 0.15\,R\,v + 0.15\,S\,v + 0.15\,A\,v + 0.15\,C}{\sum w}
```

- `v` — доля ответов с упоминанием; `V = 0.6 · organicVisibility + 0.4 · v`.
- `R` — средняя ценность позиции: 1 → 1.0, 2 → 0.75, 3 → 0.55, 4 → 0.4, 5+ → 0.3, упоминание вне списка → 0.5.
- `S` — тональность: positive 1, neutral 0.5, negative 0.
- `A` — доля упоминающих ответов без искажённых фактов и сомнительных утверждений.
- `C` — доля ответов поисковых движков со ссылкой на свои домены. Если поисковых ответов нет, слагаемое и его вес убираются.
- R, S, A умножаются на `v`, чтобы невидимый объект не набирал баллы за единичные «чистые» ответы. Тест: 1 упоминание из 4 → скор < 25; 4 из 4 с позитивом → > 80.
- `groupScore(results, key)` — тот же расчёт по движкам и интентам. Текст формулы кладётся в `method.scoring`.

### `recommend.ts` — рекомендации

Правила срабатывают только на измеренных данных, каждое кладёт цифры в `evidence`. Сортировка high → medium → low.

| id | Условие | Приоритет |
| --- | --- | --- |
| `organic-visibility` | organicVisibility < 0.30 | high |
| `engine-gap-<engine>` | отставание от лучшего движка: visibility ≥ 0.25 или organicVisibility ≥ 0.30 | medium; действия разные для поисковых и непоисковых движков |
| `contradicted-facts` | есть искажённые факты | high |
| `suspect-claims` | ≥ 2 сомнительных утверждения | medium |
| `negative-sentiment` | negativeShare > 0.20 | high |
| `own-citations` | есть поисковые движки и citationShare < 0.20 | high, если `domains` заданы, иначе medium |
| `share-of-voice` | конкуренты с упоминаниями больше, чем у объекта | medium, по действию «{s} vs {competitor}» на каждого из топ-3 |
| `rank` | avgRank > 3 | low |
| `token-trust` | `subjectType = token` и ≥ 30% trust-ответов негативные или без упоминания | high |

### `audit.ts` — оркестрация

- `runAudit(req, tier, {engines?, onProgress?})`: вопросы × движки через пул с `CONCURRENCY`, анализ, скоринг, доля голоса (только discovery-ответы, при их отсутствии — все), issues, топ доменов, рекомендации, `summaryMarkdown`.
- Если все вызовы упали — исключение с первыми ошибками; рантайм отчёт не сдаёт.
- `summaryMarkdown`: заголовок, строка со скором и метриками, таблица по движкам, доля голоса, топ-5 действий.

### `runtime.ts` + `acp.ts` — продавец

- `AcpPort` — интерфейс над acp-cli: `listen`, `activeJobs`, `history`, `setBudget`, `submit`, `message`. `cliPort` реализует его через `execFile` / `spawn` с `--json`. Тесты используют фейк.
- Состояние сделок — `data/jobs.json`, ключ `chainId:jobId`, фазы `requested → budget_set → working → submitted → closed`, плюс `invalid`.
- Обрабатываются только строки, где `roles` содержит `provider`.
- requirement → тариф по описанию сделки (имя оффера, иначе quick) → валидация. Невалидно: фаза `invalid`, сообщение клиенту «не будет списано», бюджет не ставится. Валидно: `setBudget(price)`.
- `job.funded` → проверка суммы (если ≥ price · 10⁴ — делить на 10⁶) → `working` → аудит → `buildDeliverable` → `submit` → `submitted`. Повтор события не запускает работу второй раз.
- Ошибка аудита: фаза обратно в `budget_set`, до 3 попыток с паузой 30 с (`setTimeout(...).unref()`).
- `job.completed` / `rejected` / `expired` → `closed`, причина отказа в лог.
- При старте и после падения потока событий (рестарт через 5 с) — `recover()`: OPEN без состояния → забрать requirement из истории; FUNDED не сданные → доделать.

### `deliverable.ts`, `validate.ts`, точки входа

- `buildDeliverable(report)`: пишет полный отчёт и сводку в `REPORTS_DIR`; возвращает JSON-строку ≤ `MAX_INLINE_DELIVERABLE_BYTES`, при превышении урезает `evidence` (сначала оставляя строки с упоминанием) и ставит `evidenceTruncated`.
- `validate.ts`: ajv (`allErrors`, `useDefaults`, `strict: false`) по схеме из `offering/`. Ошибки — одной строкой `path message; ...`.
- `cli.ts` — `npm run audit -- --request file.json [--tier] [--out]`. `serve.ts` — `npm run serve`, отказ стартовать без ключей (кроме мок-режима), корректный SIGINT/SIGTERM.

## Конфигурация и секреты

Всё через `.env` (dotenv), шаблон — `.env.example` в репозитории. Ключи ACP хранит сам `acp-cli` после `acp configure`, в проекте их нет.

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_WEB_SEARCH` | —, `gpt-4o-mini`, `0` | ChatGPT |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_WEB_SEARCH` | —, `claude-sonnet-5-5`, `0` | Claude и судья по умолчанию |
| `PERPLEXITY_API_KEY`, `PERPLEXITY_MODEL` | —, `sonar` | Perplexity |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | —, `gemini-2.5-flash` | Gemini |
| `JUDGE_ENGINE`, `JUDGE_MODEL` | `anthropic`, модель движка | Судья |
| `CONCURRENCY`, `REQUEST_TIMEOUT_MS` | `4`, `60000` | Параллельность и таймаут |
| `ACP_BIN` | `acp` | Путь к acp-cli |
| `OFFERING_QUICK_NAME`, `OFFERING_QUICK_PRICE` | `GEO Audit Quick`, `3` | Должны совпадать с зарегистрированным оффером |
| `OFFERING_FULL_NAME`, `OFFERING_FULL_PRICE` | `GEO Audit Full`, `15` | То же |
| `STATE_FILE`, `REPORTS_DIR` | `./data/jobs.json`, `./data/reports` | Состояние и отчёты |
| `PUBLIC_REPORT_BASE_URL` | пусто | Если задан — ссылка на полный отчёт в deliverable |
| `MAX_INLINE_DELIVERABLE_BYTES` | `60000` | Лимит inline-отчёта |
| `MOCK_ENGINES` | `0` | `1` — фейковые движки и судья, без сети |

Названия моделей по умолчанию надо сверить с провайдерами перед первым запуском. `.env` и `data/` — в `.gitignore`.

**Регистрация офферов** — `offering/register-offerings.sh` (`npm run register`): два вызова `acp offering create --json` с `--price-type fixed`, `--sla-minutes 30 | 60`, `--requirements "$(cat requirements.schema.json)"`, `--deliverable "$(cat deliverable.md)"`, `--no-required-funds --no-hidden`, затем `acp offering list --json`. Описания офферов — на английском, с перечнем метрик отчёта.

## Тестирование и критерии приёмки

Тесты — `node:test` через tsx, без сети: `MOCK_ENGINES=1`, отдельные `STATE_FILE` и `REPORTS_DIR` в `data/test/`, ACP — фейковый `AcpPort`, который записывает вызовы.

**Обязательные тест-кейсы:**

| Модуль | Кейс | Ожидание |
| --- | --- | --- |
| analyze | Тикер, регистр, кириллица | `$VIRTUAL`, `VIRTUAL`, `virtuals protocol` матчат; `VIRTUALLY`, `Альфабанк` — нет |
| analyze | Позиция в списке | `2` для второго пункта; `null` без списка |
| analyze | Свои домены | `docs.virtuals.io` засчитан для `virtuals.io` |
| queries | Тарифы и типы | Quick 8–12 вопросов на 2 языка и ≥ 1 discovery; Full больше; токен получает вопрос с контрактом; бренд не получает токеномику |
| scoring | Невидимый объект | 1 упоминание из 4 → < 25; 4 из 4 → > 80; organicVisibility = 0 |
| validate | Схема | Отказ без обязательных полей, на не-JSON и неверный enum; обёртка `requirement` принимается; default `languages = ["en"]` |
| audit | Полный прогон на моках | 4 движка; `evidence.length == probes`; visibility пересчитывается из evidence; у рекомендаций есть evidence; сводка содержит `GEO score: N/100` |
| runtime | Счастливый путь | requirement → `setBudget(price Full)` → funded в базовых единицах → `submit` валидного JSON ≤ лимита, `tier = full` |
| runtime | Повтор событий | Второй requirement и funded не дают второго `setBudget` / `submit` |
| runtime | Невалидный запрос | Нет `setBudget`, сообщение «Invalid requirement… not be charged» |
| runtime | Недоплата | `funded(0.5)` при цене 3 → нет `submit`, сообщение с ценой |
| runtime | Чужая роль | Строки без `provider` в `roles` игнорируются |
| runtime | Падение аудита | Нет `submit`, процесс тестов не висит (таймер `unref`) |

**Критерии приёмки MVP:**

- [ ] `npm run typecheck` и `npm test` зелёные.
- [ ] `MOCK_ENGINES=1 npm run audit -- --request examples/brand.json` печатает сводку и сохраняет отчёт.
- [ ] С одним реальным ключом `npm run audit` на `examples/token.json` даёт отчёт с `failed = 0`.
- [ ] `npm run register` создаёт 2 оффера, видимых в `acp browse`.
- [ ] Сделка Quick в ACP Sandbox от второго агента проходит до `completed`.
- [ ] После `kill -9` во время аудита и перезапуска сделка доделывается и сдаётся один раз.
- [ ] Себестоимость Quick по логам токенов ≤ 0,6 USD.

## План этапов с промптами для Claude Code

Семь этапов, каждый — отдельная сессия и коммит. Промпт вставлять как есть; Claude Code сам прочитает `SPEC.md` и `CLAUDE.md`.

**Этап 1. Каркас и контракты.** Готово, когда: typecheck зелёный, тесты validate проходят.

```text
Прочитай SPEC.md и CLAUDE.md. Создай каркас проекта: package.json (скрипты audit, serve, register, typecheck, test), tsconfig (strict, NodeNext), .gitignore, .env.example из раздела «Конфигурация». Создай src/types.ts с типами из раздела «Контракты данных», offering/requirements.schema.json, offering/deliverable.md, src/config.ts, src/validate.ts. Напиши тесты validate из таблицы тест-кейсов. Сначала покажи план.
```

**Этап 2. Вопросы.** Готово, когда: тесты queries проходят.

```text
Реализуй src/queries.ts по разделу «Модули → queries.ts»: шаблоны en и ru (около 16 на язык), правила types/{comp}/{ca}, отбор Quick и Full, customQueries с определением языка. Добавь examples/token.json и examples/brand.json. Тесты — из таблицы тест-кейсов.
```

**Этап 3. Движки.** Готово, когда: мок-движки детерминированы, typecheck зелёный.

```text
Реализуй src/engines.ts: интерфейс Engine, четыре живых движка через fetch по таблице endpoint'ов, опциональный веб-поиск для OpenAI и Anthropic, таймаут, ошибки в поле error, mockEngines и judgeComplete. Живые вызовы не тестируй — только мок. Сверь форматы ответов с текущей документацией провайдеров и отметь в README, что сверил.
```

**Этап 4. Анализ и скоринг.** Готово, когда: тесты analyze и scoring проходят.

```text
Реализуй src/analyze.ts (детерминированная часть + судья + офлайн-заглушка судьи для MOCK_ENGINES) и src/scoring.ts строго по формуле из SPEC.md. Текст формулы — константа SCORING_METHOD. Тесты из таблицы, включая кириллические границы слов и «невидимый объект».
```

**Этап 5. Рекомендации и отчёт.** Готово, когда: полный мок-аудит проходит тест, `npm run audit` с моками печатает сводку.

```text
Реализуй src/recommend.ts (все правила из таблицы, тексты на английском, у каждого правила evidence с цифрами), src/audit.ts (пул, доля голоса по discovery, issues, топ доменов, summaryMarkdown), src/deliverable.ts и src/cli.ts. Проверь инварианты отчёта тестом «полный прогон на моках». Запусти MOCK_ENGINES=1 npm run audit на обоих примерах и покажи сводки.
```

**Этап 6. Продавец ACP.** Готово, когда: все тесты runtime проходят.

```text
Реализуй src/acp.ts (AcpPort + cliPort поверх acp-cli с --json) и src/runtime.ts по разделам «Контекст ACP» и «Модули → runtime». Состояние в STATE_FILE, recover(), рестарт потока событий, нормализация суммы, до 3 повторов. src/serve.ts. Тесты runtime — на фейковом AcpPort из таблицы тест-кейсов. Если доступен acp-cli, сверь команды и флаги через acp --help.
```

**Этап 7. Регистрация, README, проверка вживую.** Готово, когда: выполнены критерии приёмки.

```text
Напиши offering/register-offerings.sh и README.md на русском (что продаётся, вход/выход, запуск, деплой, что не проверено). Затем помоги пройти критерии приёмки: реальный аудит с одним ключом, регистрация офферов, тестовая сделка в ACP Sandbox. Вызовы acp, которые тратят деньги, выполняй только после моего подтверждения.
```

## Деплой, эксплуатация, риски

Рантайм — один долгоживущий Node-процесс (`npm run serve`) рядом с настроенным `acp-cli`: VPS с pm2 или systemd, либо Railway / Fly с постоянным диском под `data/`. Для установки без браузера у Virtuals есть партнёрский headless-флоу (`acp agent generate-signer-key` → `acp configure --token` → `acp agent link`), иначе один раз `acp configure` на сервере.

**Эксплуатация:**

- Логи — stdout с ISO-временем: ставка бюджета, начало аудита, сдача с GEO-скором, отказы и их причины.
- Бэкап `data/jobs.json` и `data/reports/`; отчёты можно раздавать статикой и задать `PUBLIC_REPORT_BASE_URL`.
- Раз в неделю смотреть долю `job.rejected` и причины — это прямой сигнал, что отчёт не устраивает оценщиков.

**Риски:**

| Риск | Последствие | Что делаем |
| --- | --- | --- |
| Virtuals меняет формат событий или флаги acp-cli | Рантайм перестаёт видеть сделки | Вся работа с CLI изолирована в `src/acp.ts`; при обновлении прогнать `acp --help` и тесты |
| Провайдер меняет API или снимает модель | Движок падает, `failed > 0` | Ошибки движка не роняют аудит; модели в `.env`; алерт, если `failed` > 25% |
| Оценщик отклоняет отчёт | Нет оплаты | Детерминированные метрики, инварианты, evidence у каждой рекомендации |
| Ответы LLM недетерминированы | Скор «плавает» между прогонами | Описать в отчёте; в будущем — 2 прогона на вопрос и усреднение в Full |
| Себестоимость выше цены при длинных ответах | Убыток на сделке | Ограничить `max_tokens`, считать токены в логах, цены в `.env` |
| Судья галлюцинирует факты | Ложные «искажения» | Только дословные факты из `req.facts`, `temperature: 0` |

**Открытые вопросы:**

- [ ] Какие модели и цены ставим на старте — сверить у провайдеров.
- [ ] Включать ли веб-поиск у ChatGPT и Claude в Full (дороже, но ближе к реальности)?
- [ ] Нужен ли собственный оценщик или полагаемся на клиентского?
- [ ] Где хостим отчёты для `fullReportUrl`?
- [ ] Когда добавлять YandexGPT и GigaChat для рынка СНГ?
