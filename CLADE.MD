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
