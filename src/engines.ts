import type { Config } from "./config.js";
import { enabledEngines } from "./config.js";
import type { Engine, EngineAnswer, Requirements } from "./types.js";

// Опрос движков через встроенный fetch, без SDK провайдеров.
// Ошибка движка не бросается, а возвращается в EngineAnswer.error — аудит продолжается.

export const SYSTEM_PROMPT =
  "Answer the user's question the way you normally would. Reply in the language of the question.";

const ENGINE_MAX_TOKENS = 2048;
const JUDGE_MAX_TOKENS = 1024;
const MAX_ATTEMPTS = 3; // 429 / 5xx / сетевые ошибки
const ANTHROPIC_VERSION = "2023-06-01";
// Новая версия веб-поиска (dynamic filtering) для текущих моделей; старая — запасная для старых моделей.
const ANTHROPIC_WEB_SEARCH_TOOLS = ["web_search_20260209", "web_search_20250305"] as const;

type Json = Record<string, unknown>;
type FetchFn = typeof fetch;

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, headers: Record<string, string>, body: Json, timeoutMs: number, fetchFn: FetchFn): Promise<Json> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as Json;
      const err = new HttpError(res.status, text);
      if (res.status !== 429 && res.status < 500) throw err; // 4xx — повтор не поможет
      lastErr = err;
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new Error(`timeout after ${timeoutMs} ms`);
      lastErr = e;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 3 ** (attempt - 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Модели по-разному принимают параметры (например, Claude Sonnet 5.5 отвергает temperature,
 * часть моделей OpenAI — тоже). Если 400 называет необязательный параметр (или одно из его
 * ключевых слов) — убираем его и повторяем.
 */
async function postTolerant(
  url: string, headers: Record<string, string>, body: Json, optional: Record<string, string[]>, timeoutMs: number, fetchFn: FetchFn,
): Promise<Json> {
  const current: Json = { ...body };
  for (;;) {
    try {
      return await postJson(url, headers, current, timeoutMs, fetchFn);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 400) throw e;
      const culprit = Object.keys(optional).find((k) => k in current && [k, ...optional[k]!].some((w) => e.body.includes(w)));
      if (!culprit) throw e;
      delete current[culprit];
    }
  }
}

const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);
const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

function errMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Обёртка: замер времени, перевод исключения в поле error. */
function makeEngine(name: string, model: string, search: boolean, call: (prompt: string) => Promise<Omit<EngineAnswer, "engine" | "model" | "latencyMs">>): Engine {
  return {
    name, model, search,
    async ask(prompt) {
      const t0 = Date.now();
      try {
        const r = await call(prompt);
        const answer: EngineAnswer = { engine: name, model, latencyMs: Date.now() - t0, ...r };
        if (!answer.error && !answer.text.trim()) answer.error = "empty answer";
        return answer;
      } catch (e) {
        return { engine: name, model, text: "", citations: [], latencyMs: Date.now() - t0, error: errMessage(e) };
      }
    },
  };
}

// ---------- ChatGPT ----------

/** Текст и url_citation из ответа Responses API (OpenAI; тот же формат у Perplexity Agent API). */
function parseResponsesOutput(data: Json): { text: string; citations: string[] } {
  const texts: string[] = [];
  const citations: string[] = [];
  for (const item of asArray(data["output"])) {
    if (item["type"] === "message") {
      for (const part of asArray(item["content"])) {
        if (part["type"] !== "output_text") continue;
        texts.push(asString(part["text"]));
        for (const a of asArray(part["annotations"])) if (a["type"] === "url_citation") citations.push(asString(a["url"]));
      }
    } else if (item["type"] === "search_results") {
      for (const r of asArray(item["results"])) citations.push(asString(r["url"]));
    }
  }
  return { text: texts.join("\n").trim(), citations: uniq(citations) };
}

export function openaiEngine(cfg: Config, fetchFn: FetchFn = fetch): Engine {
  const { apiKey, model, webSearch } = cfg.openai;
  const headers = { authorization: `Bearer ${apiKey}` };
  return makeEngine("chatgpt", model, webSearch, async (prompt) => {
    if (webSearch) {
      const data = await postJson("https://api.openai.com/v1/responses", headers, {
        model, instructions: SYSTEM_PROMPT, input: prompt, tools: [{ type: "web_search" }], max_output_tokens: ENGINE_MAX_TOKENS,
      }, cfg.requestTimeoutMs, fetchFn);
      const usage = data["usage"] as Json | undefined;
      return { ...parseResponsesOutput(data), usage: usage && { inputTokens: Number(usage["input_tokens"] ?? 0), outputTokens: Number(usage["output_tokens"] ?? 0) } };
    }
    const data = await postJson("https://api.openai.com/v1/chat/completions", headers, {
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      max_completion_tokens: ENGINE_MAX_TOKENS,
    }, cfg.requestTimeoutMs, fetchFn);
    const usage = data["usage"] as Json | undefined;
    const msg = asArray(data["choices"])[0]?.["message"] as Json | undefined;
    return {
      text: asString(msg?.["content"]).trim(),
      citations: [],
      usage: usage && { inputTokens: Number(usage["prompt_tokens"] ?? 0), outputTokens: Number(usage["completion_tokens"] ?? 0) },
    };
  });
}

// ---------- Claude ----------

interface AnthropicCall {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  webSearch: boolean;
  temperature?: number;
}

/** Вызов Messages API: текст из text-блоков, ссылки из citations[], продолжение после pause_turn. */
async function anthropicMessages(cfg: Config, c: AnthropicCall, fetchFn: FetchFn) {
  const headers = { "x-api-key": cfg.anthropic.apiKey, "anthropic-version": ANTHROPIC_VERSION };
  const messages: Json[] = [{ role: "user", content: c.prompt }];
  const texts: string[] = [];
  const citations: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolIdx = 0;

  for (let turn = 0; turn < 4; turn++) {
    const body: Json = {
      model: c.model,
      max_tokens: c.maxTokens,
      system: c.system,
      messages,
      // Ответ, а не размышления: низкий effort дешевле и ближе к обычному чату.
      output_config: { effort: "low" },
      ...(c.temperature !== undefined ? { temperature: c.temperature } : {}),
      ...(c.webSearch ? { tools: [{ type: ANTHROPIC_WEB_SEARCH_TOOLS[toolIdx], name: "web_search", max_uses: 3 }] } : {}),
    };
    let data: Json;
    try {
      data = await postTolerant("https://api.anthropic.com/v1/messages", headers, body, { temperature: [], output_config: ["effort"] }, cfg.requestTimeoutMs, fetchFn);
    } catch (e) {
      const legacy = ANTHROPIC_WEB_SEARCH_TOOLS[toolIdx + 1];
      if (c.webSearch && legacy && e instanceof HttpError && e.status === 400 && e.body.includes("web_search")) {
        toolIdx++;
        turn--;
        continue;
      }
      throw e;
    }

    const usage = data["usage"] as Json | undefined;
    inputTokens += Number(usage?.["input_tokens"] ?? 0);
    outputTokens += Number(usage?.["output_tokens"] ?? 0);
    const content = asArray(data["content"]);
    for (const block of content) {
      if (block["type"] !== "text") continue; // thinking, server_tool_use, web_search_tool_result пропускаем
      texts.push(asString(block["text"]));
      for (const cit of asArray(block["citations"])) citations.push(asString(cit["url"]));
    }

    const stop = data["stop_reason"];
    if (stop === "refusal") throw new Error("refusal");
    if (stop !== "pause_turn") break;
    // Серверный инструмент поставил ход на паузу — продолжаем с тем же содержимым.
    messages.push({ role: "assistant", content });
  }
  return { text: texts.join("").trim(), citations: uniq(citations), usage: { inputTokens, outputTokens } };
}

export function anthropicEngine(cfg: Config, fetchFn: FetchFn = fetch): Engine {
  const { model, webSearch } = cfg.anthropic;
  return makeEngine("claude", model, webSearch, (prompt) =>
    anthropicMessages(cfg, { model, system: SYSTEM_PROMPT, prompt, maxTokens: ENGINE_MAX_TOKENS, webSearch }, fetchFn));
}

// ---------- Perplexity ----------

export function perplexityEngine(cfg: Config, fetchFn: FetchFn = fetch): Engine {
  const { apiKey, model } = cfg.perplexity;
  return makeEngine("perplexity", model, true, async (prompt) => {
    // /chat/completions официально заменён на Agent API (27.09.2026), но синхронные запросы
    // продолжают работать. Парсер понимает оба формата ответа.
    const data = await postJson("https://api.perplexity.ai/chat/completions", { authorization: `Bearer ${apiKey}` }, {
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      max_tokens: ENGINE_MAX_TOKENS,
    }, cfg.requestTimeoutMs, fetchFn);
    const usage = data["usage"] as Json | undefined;
    const tokens = usage && {
      inputTokens: Number(usage["prompt_tokens"] ?? usage["input_tokens"] ?? 0),
      outputTokens: Number(usage["completion_tokens"] ?? usage["output_tokens"] ?? 0),
    };
    if (Array.isArray(data["output"])) return { ...parseResponsesOutput(data), usage: tokens };
    const msg = asArray(data["choices"])[0]?.["message"] as Json | undefined;
    const citations = [
      ...(Array.isArray(data["citations"]) ? (data["citations"] as unknown[]).map(asString) : []),
      ...asArray(data["search_results"]).map((r) => asString(r["url"])),
    ];
    return { text: asString(msg?.["content"]).trim(), citations: uniq(citations), usage: tokens };
  });
}

// ---------- Gemini ----------

const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

export function geminiEngine(cfg: Config, fetchFn: FetchFn = fetch): Engine {
  const { apiKey, model } = cfg.gemini;
  return makeEngine("gemini", model, true, async (prompt) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const data = await postJson(url, { "x-goog-api-key": apiKey }, {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: ENGINE_MAX_TOKENS },
    }, cfg.requestTimeoutMs, fetchFn);
    const cand = asArray(data["candidates"])[0];
    const parts = asArray((cand?.["content"] as Json | undefined)?.["parts"]);
    const chunks = asArray((cand?.["groundingMetadata"] as Json | undefined)?.["groundingChunks"]);
    // uri — редирект vertexaisearch, настоящий домен лежит в title.
    const citations = chunks.map((ch) => {
      const web = (ch["web"] ?? {}) as Json;
      const title = asString(web["title"]).trim().toLowerCase();
      return DOMAIN_RE.test(title) ? `https://${title}/` : asString(web["uri"]);
    });
    const usage = data["usageMetadata"] as Json | undefined;
    const finish = asString(cand?.["finishReason"]);
    const text = parts.map((p) => asString(p["text"])).join("").trim();
    return {
      text,
      citations: uniq(citations),
      ...(!text && finish && finish !== "STOP" ? { error: `finishReason ${finish}` } : {}),
      usage: usage && { inputTokens: Number(usage["promptTokenCount"] ?? 0), outputTokens: Number(usage["candidatesTokenCount"] ?? 0) },
    };
  });
}

// ---------- Судья ----------

/** Вызов LLM-судьи (Anthropic по умолчанию, OpenAI при JUDGE_ENGINE=openai), temperature 0 где модель позволяет. Бросает при ошибке. */
export async function judgeComplete(cfg: Config, prompt: string, fetchFn: FetchFn = fetch): Promise<string> {
  const system = "You are a strict, factual evaluator. Reply with JSON only, no prose.";
  if (cfg.judge.engine === "openai") {
    if (!cfg.openai.apiKey) throw new Error("judge: OPENAI_API_KEY is not set");
    const data = await postTolerant("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${cfg.openai.apiKey}` }, {
      model: cfg.judge.model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_completion_tokens: JUDGE_MAX_TOKENS,
      temperature: 0,
      response_format: { type: "json_object" },
    }, { temperature: [], response_format: [] }, cfg.requestTimeoutMs, fetchFn);
    const msg = asArray(data["choices"])[0]?.["message"] as Json | undefined;
    return asString(msg?.["content"]);
  }
  if (!cfg.anthropic.apiKey) throw new Error("judge: ANTHROPIC_API_KEY is not set");
  const r = await anthropicMessages(cfg, { model: cfg.judge.model, system, prompt, maxTokens: JUDGE_MAX_TOKENS, webSearch: false, temperature: 0 }, fetchFn);
  return r.text;
}

// ---------- Моки ----------

/** FNV-1a 32 бита. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const MOCK_SEARCH: Record<string, boolean> = { chatgpt: false, claude: false, perplexity: true, gemini: true };
const MOCK_FILLERS = ["Nova Labs", "Quantum Forge", "Atlas Network", "Helix", "Orbit Studio", "Lumen", "Zephyr"];

/**
 * Детерминированные фейки: нумерованный список конкурентов, объект вставлен по смещению из хеша
 * (или пропущен); часть ответов с «risks»; у поисковых — фиктивные цитаты.
 */
export function mockEngines(subject: string, competitors: string[] = [], opts: { domains?: string[] } = {}): Engine[] {
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "") || "subject";
  const ownDomain = opts.domains?.[0] ?? `${slug}.io`;
  const others = [...competitors, ...MOCK_FILLERS.filter((f) => !competitors.includes(f))].slice(0, 5);

  return Object.entries(MOCK_SEARCH).map(([name, search]) => {
    const model = `mock-${name}`;
    return makeEngine(name, model, search, async (prompt) => {
      const h = fnv1a(`${name}\u0000${prompt}`);
      const ru = /\p{Script=Cyrillic}/u.test(prompt);
      const named = prompt.toLowerCase().includes(subject.toLowerCase());
      // Если объект назван в вопросе — упоминаем всегда; иначе в ~2/3 случаев.
      const include = named || h % 3 !== 0;
      const list = [...others];
      if (include) list.splice((h >>> 4) % (list.length + 1), 0, subject);
      const risky = (h >>> 8) % 4 === 0;

      const lines = [
        ru ? "Вот несколько вариантов, на которые стоит посмотреть:" : "Here are some options worth a look:",
        "",
        ...list.map((n, i) => `${i + 1}. **${n}** — ${ru ? "известный проект в своей нише." : "a well-known name in this space."}`),
        "",
      ];
      if (risky && include) {
        lines.push(ru
          ? `Учтите риски: у ${subject} были жалобы пользователей, проверяйте информацию самостоятельно.`
          : `Keep in mind the risks: ${subject} has drawn user complaints, so do your own research.`);
      } else {
        lines.push(ru ? "Выбор зависит от ваших задач." : "The right choice depends on your needs.");
      }

      const citations = search
        ? uniq([
            (h >>> 12) % 2 === 0 ? `https://docs.${ownDomain}/overview` : "",
            `https://en.wikipedia.org/wiki/${encodeURIComponent(list[0] ?? subject)}`,
            `https://www.example-news.com/${(h >>> 16) % 1000}`,
          ])
        : [];
      return { text: lines.join("\n"), citations, usage: { inputTokens: 0, outputTokens: 0 } };
    });
  });
}

/** Движки для аудита: моки в MOCK_ENGINES=1, иначе живые — только те, у кого задан ключ. */
export function buildEngines(cfg: Config, req: Pick<Requirements, "subject" | "competitors" | "domains">): Engine[] {
  if (cfg.mockEngines) return mockEngines(req.subject, req.competitors, { domains: req.domains });
  const factories = { chatgpt: openaiEngine, claude: anthropicEngine, perplexity: perplexityEngine, gemini: geminiEngine };
  return enabledEngines(cfg).map((n) => factories[n](cfg));
}
