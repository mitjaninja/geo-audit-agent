import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import {
  anthropicEngine, buildEngines, fnv1a, geminiEngine, judgeComplete, mockEngines, openaiEngine, perplexityEngine,
} from "../src/engines.js";

// Сети нет: живые движки проверяются на подставном fetch, который записывает запросы.
type Reply = { status?: number; body: unknown };
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const cfg = loadConfig({
  OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k", PERPLEXITY_API_KEY: "k", GEMINI_API_KEY: "k", REQUEST_TIMEOUT_MS: "5000",
});

test("mock: 4 движка, поиск только у perplexity и gemini", () => {
  const engines = mockEngines("Virtuals Protocol", ["ai16z"]);
  assert.deepEqual(engines.map((e) => e.name), ["chatgpt", "claude", "perplexity", "gemini"]);
  assert.deepEqual(engines.map((e) => e.search), [false, false, true, true]);
  assert.equal(buildEngines(loadConfig({ MOCK_ENGINES: "1" }), { subject: "X Y" }).length, 4);
});

test("mock: детерминированы и зависят от движка и вопроса", async () => {
  const q = "What are the best AI agent launchpads right now?";
  const a = await Promise.all(mockEngines("Virtuals Protocol", ["ai16z", "Olas"]).map((e) => e.ask(q)));
  const b = await Promise.all(mockEngines("Virtuals Protocol", ["ai16z", "Olas"]).map((e) => e.ask(q)));
  assert.deepEqual(a.map((x) => ({ ...x, latencyMs: 0 })), b.map((x) => ({ ...x, latencyMs: 0 })));
  assert.equal(new Set(a.map((x) => x.text)).size > 1, true);
  assert.equal(fnv1a("abc"), fnv1a("abc"));
  assert.notEqual(fnv1a("abc"), fnv1a("abd"));
});

test("mock: нумерованный список, объект всегда есть, если назван в вопросе; цитаты у поисковых", async () => {
  const engines = mockEngines("Virtuals Protocol", ["ai16z", "Olas"], { domains: ["virtuals.io"] });
  let risky = 0;
  let omitted = 0;
  for (let i = 0; i < 40; i++) {
    for (const e of engines) {
      const named = await e.ask(`What is Virtuals Protocol? #${i}`);
      assert.equal(named.error, undefined);
      assert.match(named.text, /^1\. \*\*/m);
      assert.ok(named.text.includes("Virtuals Protocol"));
      if (/risks/.test(named.text)) risky++;
      assert.equal(named.citations.length > 0, e.search);
      if (e.search) assert.ok(named.citations.every((u) => u.startsWith("https://")));
      const discovery = await e.ask(`What are the best launchpads? #${i}`);
      if (!discovery.text.includes("Virtuals Protocol")) omitted++;
    }
  }
  assert.ok(risky > 0, "часть ответов с risks");
  assert.ok(omitted > 0, "в discovery объект иногда отсутствует");
});

test("mock: русский вопрос — русский ответ", async () => {
  const [e] = mockEngines("Notion");
  const a = await e!.ask("Что такое Notion?");
  assert.match(a.text, /\p{Script=Cyrillic}/u);
});

test("chatgpt: chat completions — текст и токены", async () => {
  const { fn, calls } = fakeFetch([{ body: { choices: [{ message: { content: " Hello " } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }]);
  const a = await openaiEngine(cfg, fn).ask("hi");
  assert.equal(calls[0]!.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0]!.headers["authorization"], "Bearer k");
  assert.equal(a.text, "Hello");
  assert.deepEqual(a.citations, []);
  assert.deepEqual(a.usage, { inputTokens: 10, outputTokens: 5 });
});

test("chatgpt: Responses API с web_search — url_citation", async () => {
  const c = loadConfig({ OPENAI_API_KEY: "k", OPENAI_WEB_SEARCH: "1" });
  const { fn, calls } = fakeFetch([{ body: { output: [
    { type: "web_search_call" },
    { type: "message", content: [{ type: "output_text", text: "Answer", annotations: [
      { type: "url_citation", url: "https://a.com/x" }, { type: "url_citation", url: "https://a.com/x" }, { type: "url_citation", url: "https://b.com" },
    ] }] },
  ], usage: { input_tokens: 3, output_tokens: 4 } } }]);
  const e = openaiEngine(c, fn);
  assert.equal(e.search, true);
  const a = await e.ask("q");
  assert.equal(calls[0]!.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(calls[0]!.body["tools"], [{ type: "web_search" }]);
  assert.equal(a.text, "Answer");
  assert.deepEqual(a.citations, ["https://a.com/x", "https://b.com"]);
});

test("claude: текст из text-блоков, цитаты из citations[], thinking пропускается", async () => {
  const c = loadConfig({ ANTHROPIC_API_KEY: "k", ANTHROPIC_WEB_SEARCH: "1" });
  const { fn, calls } = fakeFetch([{ body: {
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "" },
      { type: "server_tool_use", name: "web_search" },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://not-cited.com" }] },
      { type: "text", text: "Virtuals is ", citations: [{ type: "web_search_result_location", url: "https://virtuals.io/a" }] },
      { type: "text", text: "a launchpad." },
    ],
    usage: { input_tokens: 7, output_tokens: 8 },
  } }]);
  const a = await anthropicEngine(c, fn).ask("What is Virtuals?");
  assert.equal(calls[0]!.headers["anthropic-version"], "2023-06-01");
  assert.equal((calls[0]!.body["tools"] as { type: string }[])[0]!.type, "web_search_20260209");
  assert.equal(a.text, "Virtuals is a launchpad.");
  assert.deepEqual(a.citations, ["https://virtuals.io/a"]);
});

test("claude: pause_turn продолжается, старый тип веб-поиска как запасной", async () => {
  const c = loadConfig({ ANTHROPIC_API_KEY: "k", ANTHROPIC_WEB_SEARCH: "1", ANTHROPIC_MODEL: "claude-haiku-4-5" });
  const { fn, calls } = fakeFetch([
    { status: 400, body: '{"error":{"message":"tools.0: web_search_20260209 is not supported for this model"}}' },
    { body: { stop_reason: "pause_turn", content: [{ type: "text", text: "Part 1. " }] } },
    { body: { stop_reason: "end_turn", content: [{ type: "text", text: "Part 2." }] } },
  ]);
  const a = await anthropicEngine(c, fn).ask("q");
  assert.equal(a.error, undefined, a.error);
  assert.equal(a.text, "Part 1. Part 2.");
  assert.equal((calls[1]!.body["tools"] as { type: string }[])[0]!.type, "web_search_20250305");
  assert.equal((calls[2]!.body["messages"] as unknown[]).length, 2);
});

test("claude: refusal и 4xx возвращаются в error без повторов", async () => {
  const r1 = fakeFetch([{ body: { stop_reason: "refusal", content: [] } }]);
  assert.equal((await anthropicEngine(cfg, r1.fn).ask("q")).error, "refusal");
  const r2 = fakeFetch([{ status: 401, body: '{"error":"invalid x-api-key"}' }]);
  const a = await anthropicEngine(cfg, r2.fn).ask("q");
  assert.match(a.error!, /HTTP 401/);
  assert.equal(r2.calls.length, 1);
});

test("perplexity: citations[] и search_results[] объединяются; формат Agent API тоже понимается", async () => {
  const { fn } = fakeFetch([{ body: {
    choices: [{ message: { content: "Text" } }],
    citations: ["https://a.com", "https://b.com"],
    search_results: [{ url: "https://b.com", title: "B" }, { url: "https://c.com" }],
  } }]);
  const a = await perplexityEngine(cfg, fn).ask("q");
  assert.equal(a.text, "Text");
  assert.deepEqual(a.citations, ["https://a.com", "https://b.com", "https://c.com"]);

  const agent = fakeFetch([{ body: { output: [
    { type: "message", content: [{ type: "output_text", text: "Agent text", annotations: [{ type: "url_citation", url: "https://d.com" }] }] },
    { type: "search_results", results: [{ url: "https://e.com" }] },
  ] } }]);
  const b = await perplexityEngine(cfg, agent.fn).ask("q");
  assert.equal(b.text, "Agent text");
  assert.deepEqual(b.citations, ["https://d.com", "https://e.com"]);
});

test("gemini: google_search, домен из title вместо редиректа", async () => {
  const { fn, calls } = fakeFetch([{ body: { candidates: [{
    content: { parts: [{ text: "Gemini " }, { text: "answer" }] },
    finishReason: "STOP",
    groundingMetadata: { groundingChunks: [
      { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "docs.virtuals.io" } },
      { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/def", title: "Some Page Title" } },
    ] },
  }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } } }]);
  const a = await geminiEngine(cfg, fn).ask("q");
  assert.match(calls[0]!.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(calls[0]!.headers["x-goog-api-key"], "k");
  assert.deepEqual(calls[0]!.body["tools"], [{ google_search: {} }]);
  assert.equal(a.text, "Gemini answer");
  assert.deepEqual(a.citations, ["https://docs.virtuals.io/", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/def"]);
  assert.deepEqual(a.usage, { inputTokens: 2, outputTokens: 3 });
});

test("ошибки: пустой ответ и таймаут уходят в error", async () => {
  const empty = fakeFetch([{ body: { choices: [{ message: { content: "" } }] } }]);
  assert.equal((await openaiEngine(cfg, empty.fn).ask("q")).error, "empty answer");
  const slow = (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => {
    init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
  })) as typeof fetch;
  const a = await openaiEngine(loadConfig({ OPENAI_API_KEY: "k", REQUEST_TIMEOUT_MS: "20" }), slow).ask("q");
  assert.match(a.error!, /timeout/);
});

test("judge: temperature 0, а при отказе модели — повтор без него", async () => {
  const { fn, calls } = fakeFetch([
    { status: 400, body: '{"error":{"message":"temperature is not supported for this model"}}' },
    { body: { stop_reason: "end_turn", content: [{ type: "text", text: '{"sentiment":"neutral"}' }] } },
  ]);
  const out = await judgeComplete(cfg, "judge this", fn);
  assert.equal(out, '{"sentiment":"neutral"}');
  assert.equal(calls[0]!.body["temperature"], 0);
  assert.equal("temperature" in calls[1]!.body, false);
  assert.equal(calls[0]!.body["model"], "claude-sonnet-5-5");

  const oa = fakeFetch([{ body: { choices: [{ message: { content: "{}" } }] } }]);
  await judgeComplete(loadConfig({ OPENAI_API_KEY: "k", JUDGE_ENGINE: "openai" }), "x", oa.fn);
  assert.equal(oa.calls[0]!.body["model"], "gpt-4o-mini");
  await assert.rejects(judgeComplete(loadConfig({}), "x", fn), /ANTHROPIC_API_KEY/);
});
