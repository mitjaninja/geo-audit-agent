# geo-audit-agent

GEO Audit Agent — агент-продавец GEO-аудитов в Virtuals ACP. Спрашивает ChatGPT, Claude, Perplexity и Gemini о бренде, токене или продукте и возвращает проверяемый JSON-отчёт. Источник истины — [SPEC.md](SPEC.md). Полный README появится на этапе 7.

## Сверка API провайдеров (этап 3, 6 октября 2026)

Форматы запросов и ответов в `src/engines.ts` сверены с документацией провайдеров. Живые вызовы ещё не делались: разбор ответов проверен тестами на подставном `fetch`.

| Движок | Что сверено | Расхождения со спеком и решения |
| --- | --- | --- |
| ChatGPT | `/v1/chat/completions`: `choices[0].message.content`. `/v1/responses` с tool `web_search` (не `web_search_preview`): текст в `output[type=message].content[type=output_text].text`, ссылки в `annotations[type=url_citation].url` | `gpt-4o-mini` больше нет в списке моделей OpenAI; в документации веб-поиска он не значится. Модель по умолчанию надо выбрать заново (например, дешёвая `gpt-6-luna`). Вместо `max_tokens` используется `max_completion_tokens`, его принимают и старые, и новые модели |
| Claude | `/v1/messages`, `anthropic-version: 2023-06-01`. Текст из блоков `text`, ссылки из `text.citations[].url`. Блоки `thinking` и `web_search_tool_result` пропускаются, `pause_turn` продолжается | Для Sonnet 5.5 нужен инструмент `web_search_20260209`. `web_search_20250305` из спека оставлен запасным для старых моделей и подставляется автоматически при 400. Sonnet 5.5 отвергает `temperature`, поэтому судья шлёт `temperature: 0` и при 400 повторяет запрос без неё. `output_config.effort: "low"` экономит токены размышлений |
| Perplexity | `/chat/completions`, модель `sonar`. Ссылки из `citations[]` и `search_results[].url` | Chat Completions официально закрыт 27.09.2026; синхронные запросы пока работают, Perplexity переводит их на Agent API (`/v1/agent`). Парсер уже понимает и формат Agent API (`output[]`), но эндпоинт в ближайшее время стоит переключить |
| Gemini | `v1beta/models/{model}:generateContent`, `x-goog-api-key`, tool `google_search`. Текст из `candidates[0].content.parts[].text`, источники из `groundingMetadata.groundingChunks[].web`: `uri` — редирект, домен берётся из `title` | `gemini-2.5-flash` ещё доступна, но Google рекомендует Gemini 3.x. Появился новый Interactions API, `generateContent` при этом не помечен устаревшим |

Общее для всех движков:
- таймаут через `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`;
- до 3 попыток на 429, 5xx и сетевые ошибки; на остальные 4xx — сразу ошибка;
- ошибка движка не бросается, а возвращается в `EngineAnswer.error`;
- токены пишутся в `usage` для подсчёта себестоимости.

Источники: [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search), [OpenAI models](https://developers.openai.com/api/docs/models), [Perplexity chat completions](https://docs.perplexity.ai/api-reference/chat-completions-post), [Perplexity Agent API](https://docs.perplexity.ai/api-reference/agent-post), [Gemini grounding](https://ai.google.dev/gemini-api/docs/google-search), [Gemini generateContent](https://ai.google.dev/api/generate-content).
