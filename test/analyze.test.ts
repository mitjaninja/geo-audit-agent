import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAnswer, buildJudge, citedDomains, EXCERPT_MAX, excerptAround, firstMention, isOwnDomain, listRank,
  mentions, mockJudge, names, parseVerdict, type Judge,
} from "../src/analyze.js";
import { loadConfig } from "../src/config.js";
import type { EngineAnswer, Probe, Requirements } from "../src/types.js";

const req: Requirements = {
  subject: "Virtuals Protocol",
  subjectType: "token",
  category: "AI agent launchpads",
  aliases: ["$VIRTUAL"],
  domains: ["virtuals.io"],
  competitors: ["ai16z", "Olas"],
  facts: ["VIRTUAL has a total supply of 1 billion tokens"],
  languages: ["en"],
};
const n = names(req);
const probe: Probe = { id: "en.d1", intent: "discovery", lang: "en", query: "What are the best AI agent launchpads?", namesSubject: false };
const answer = (text: string, citations: string[] = []): EngineAnswer => ({ engine: "perplexity", model: "sonar", text, citations, latencyMs: 1 });

test("analyze: names — subject, aliases, $TICKER → TICKER", () => {
  assert.deepEqual(new Set(n), new Set(["Virtuals Protocol", "$VIRTUAL", "VIRTUAL"]));
});

test("analyze: тикер, регистр, границы слов", () => {
  assert.ok(mentions("Buy $VIRTUAL today", n));
  assert.ok(mentions("VIRTUAL is up 5%", n));
  assert.ok(mentions("I like virtuals protocol.", n));
  assert.ok(mentions("(VIRTUAL)", n));
  assert.ok(!mentions("This is VIRTUALLY impossible", n));
  assert.ok(!mentions("virtualization", n));
  assert.ok(!mentions("VIRTUAL2", n));
});

test("analyze: кириллические границы слов", () => {
  const ru = ["Альфа"];
  assert.ok(!mentions("Альфабанк выпустил отчёт", ru));
  assert.ok(mentions("Банк «Альфа» выпустил отчёт", ru));
  assert.ok(mentions("альфа, бета", ru));
  assert.ok(!mentions("Суперальфа", ru));
});

test("analyze: позиция в списке — 2 для второго пункта, null без списка", () => {
  assert.equal(listRank("Top picks:\n1. ai16z — good\n2. Virtuals Protocol — great\n3. Olas", n), 2);
  assert.equal(listRank("- Olas\n- **$VIRTUAL**\n- ai16z", n), 2);
  assert.equal(listRank("Virtuals Protocol is a launchpad for AI agents.", n), null);
  // Один пункт — не список.
  assert.equal(listRank("1. Virtuals Protocol", n), null);
  // Пустые строки и подпункты не рвут список.
  assert.equal(listRank("1. Olas\n   - details\n\n2. ai16z\n   - also VIRTUALLY good\n3. Virtuals Protocol", n), 3);
  // Объект только в подпункте — засчитывается родительский пункт.
  assert.equal(listRank("1. Olas\n2. Launchpads\n   - e.g. Virtuals Protocol", n), 2);
  // Первый список без объекта, второй — с ним.
  assert.equal(listRank("1. a\n2. b\nText\n- c\n- Virtuals Protocol", n), 2);
});

test("analyze: свои домены — поддомены засчитываются", () => {
  assert.deepEqual(citedDomains(["https://www.virtuals.io/x", "https://docs.virtuals.io/a", "not a url"]), ["virtuals.io", "docs.virtuals.io"]);
  assert.ok(isOwnDomain("docs.virtuals.io", ["virtuals.io"]));
  assert.ok(isOwnDomain("virtuals.io", ["https://www.virtuals.io/"]));
  assert.ok(!isOwnDomain("notvirtuals.io", ["virtuals.io"]));
  assert.ok(!isOwnDomain("virtuals.io.evil.com", ["virtuals.io"]));
});

test("analyze: excerpt ≤ 240 символов вокруг первого упоминания", () => {
  const long = `${"Lorem ipsum dolor sit amet. ".repeat(30)}Virtuals Protocol is here. ${"More text follows. ".repeat(30)}`;
  const at = firstMention(long, n);
  const ex = excerptAround(long, at);
  assert.ok(ex.length <= EXCERPT_MAX, String(ex.length));
  assert.ok(ex.includes("Virtuals Protocol"));
  assert.ok(ex.startsWith("…") && ex.endsWith("…"));
  assert.equal(excerptAround("short   text\n\nhere", -1), "short text here");
  assert.ok(excerptAround(long, -1).length <= EXCERPT_MAX);
});

test("analyze: судья — только дословные факты, ≤ 3 утверждений, объект не в конкурентах", () => {
  const v = parseVerdict(`Sure! {"sentiment":"Negative","contradictedFacts":["VIRTUAL has a total supply of 1 billion tokens","made up fact"],
    "suspectClaims":["a","b","c","d"],"competitors":["ai16z","Virtuals Protocol","$VIRTUAL","Olas","ai16z"]}`, req);
  assert.equal(v.sentiment, "negative");
  assert.deepEqual(v.contradictedFacts, ["VIRTUAL has a total supply of 1 billion tokens"]);
  assert.deepEqual(v.suspectClaims, ["a", "b", "c"]);
  assert.deepEqual(v.competitors, ["ai16z", "Olas"]);
  assert.equal(parseVerdict('{"sentiment":"great"}', req).sentiment, null);
  assert.throws(() => parseVerdict("no json here", req));
});

test("analyze: полный разбор ответа с упоминанием", async () => {
  const text = "Best launchpads:\n1. ai16z\n2. Virtuals Protocol — popular, but keep in mind the risks.\n3. Olas";
  const r = await analyzeAnswer(req, probe, answer(text, ["https://docs.virtuals.io/a", "https://www.coindesk.com/x"]), { search: true, judge: mockJudge() });
  assert.equal(r.mentioned, true);
  assert.equal(r.rank, 2);
  assert.equal(r.sentiment, "negative");
  assert.equal(r.suspectClaims.length, 1);
  assert.deepEqual(r.citedDomains, ["docs.virtuals.io", "coindesk.com"]);
  assert.equal(r.ownDomainCited, true);
  assert.deepEqual(r.competitorsMentioned, ["ai16z", "Olas"]);
  assert.ok(r.excerpt.includes("Virtuals Protocol"));
});

test("analyze: без упоминания судья не вызывается, если конкуренты заданы", async () => {
  let calls = 0;
  const judge: Judge = async () => { calls++; return { sentiment: "positive", contradictedFacts: [], suspectClaims: [], competitors: [] }; };
  const r = await analyzeAnswer(req, probe, answer("1. ai16z\n2. Olas"), { search: false, judge });
  assert.equal(r.mentioned, false);
  assert.equal(r.rank, null);
  assert.equal(r.sentiment, null);
  assert.equal(calls, 0);
  // Без конкурентов судья нужен, чтобы их извлечь, но тональность не ставится.
  const noComp = { ...req, competitors: undefined };
  const r2 = await analyzeAnswer(noComp, probe, answer("1. **ai16z**\n2. **Olas**"), { search: false, judge: mockJudge() });
  assert.deepEqual(r2.competitorsMentioned, ["ai16z", "Olas"]);
  assert.equal(r2.sentiment, null);
});

test("analyze: сбой судьи не роняет разбор", async () => {
  const errors: unknown[] = [];
  const judge: Judge = async () => { throw new Error("judge down"); };
  const r = await analyzeAnswer(req, probe, answer("Virtuals Protocol is fine"), { search: false, judge, onJudgeError: (e) => errors.push(e) });
  assert.equal(r.mentioned, true);
  assert.equal(r.sentiment, null);
  assert.equal(errors.length, 1);
});

test("analyze: ошибка движка → mentioned = null", async () => {
  const r = await analyzeAnswer(req, probe, { ...answer(""), error: "HTTP 500" }, { search: true, judge: mockJudge() });
  assert.equal(r.mentioned, null);
  assert.equal(r.excerpt, "");
});

test("analyze: buildJudge по конфигу", () => {
  assert.ok(buildJudge(loadConfig({ MOCK_ENGINES: "1" })));
  assert.equal(buildJudge(loadConfig({})), null);
  assert.ok(buildJudge(loadConfig({ ANTHROPIC_API_KEY: "k" })));
  assert.equal(buildJudge(loadConfig({ ANTHROPIC_API_KEY: "k", JUDGE_ENGINE: "openai" })), null);
});
