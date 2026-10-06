import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecommendations, type RecommendInput } from "../src/recommend.js";
import { groupScore, score } from "../src/scoring.js";
import type { Intent, ProbeResult, Requirements, Sentiment } from "../src/types.js";

interface Opts {
  engine?: string;
  intent?: Intent;
  mentioned?: boolean | null;
  rank?: number | null;
  sentiment?: Sentiment | null;
  search?: boolean;
  own?: boolean;
  facts?: string[];
  claims?: string[];
  competitors?: string[];
}
function r(o: Opts = {}): ProbeResult {
  const intent = o.intent ?? "discovery";
  const mentioned = o.mentioned === undefined ? true : o.mentioned;
  return {
    probe: { id: "x", intent, lang: "en", query: `q-${intent}`, namesSubject: intent !== "discovery" },
    answer: { engine: o.engine ?? "chatgpt", model: "m", text: "t", citations: [], latencyMs: 1 },
    search: o.search ?? false,
    mentioned,
    rank: o.rank ?? null,
    sentiment: o.sentiment === undefined ? (mentioned ? "neutral" : null) : o.sentiment,
    excerpt: "excerpt",
    citedDomains: o.own ? ["acme.io"] : ["other.com"],
    ownDomainCited: o.own ?? false,
    competitorsMentioned: o.competitors ?? [],
    contradictedFacts: o.facts ?? [],
    suspectClaims: o.claims ?? [],
  };
}

const req: Requirements = { subject: "Acme", subjectType: "brand", category: "widgets", domains: ["acme.io"], languages: ["en"] };

function input(results: ProbeResult[], over: Partial<RecommendInput> = {}): RecommendInput {
  return {
    req, results,
    overall: score(results),
    byEngine: groupScore(results, "engine"),
    shareOfVoice: [{ name: "Acme", mentions: results.filter((x) => x.mentioned).length, share: 0.5 }],
    topCitedDomains: [{ domain: "other.com", count: 3 }],
    ...over,
  };
}
const ids = (inp: RecommendInput) => buildRecommendations(inp).map((x) => x.id);

test("recommend: здоровый объект — правила не срабатывают", () => {
  const rs = [r({ rank: 1, sentiment: "positive" }), r({ rank: 1, sentiment: "positive", engine: "claude" })];
  assert.deepEqual(ids(input(rs)), []);
});

test("recommend: organic-visibility < 0.30 — high, с цифрами", () => {
  const rs = [r({ mentioned: false }), r({ mentioned: false }), r({ mentioned: false }), r({ intent: "direct" })];
  const recs = buildRecommendations(input(rs));
  const rec = recs.find((x) => x.id === "organic-visibility")!;
  assert.equal(rec.priority, "high");
  assert.match(rec.evidence[0]!, /organicVisibility = 0\.000 \(0 of 3/);
});

test("recommend: engine-gap — разные действия для поисковых и непоисковых", () => {
  const rs = [
    ...[1, 2, 3, 4].map(() => r({ engine: "chatgpt" })),
    ...[1, 2, 3, 4].map((i) => r({ engine: "perplexity", search: true, mentioned: i === 1, own: true })),
    ...[1, 2, 3, 4].map((i) => r({ engine: "claude", mentioned: i <= 2 })),
  ];
  const recs = buildRecommendations(input(rs));
  const pplx = recs.find((x) => x.id === "engine-gap-perplexity")!;
  const claude = recs.find((x) => x.id === "engine-gap-claude")!;
  assert.equal(pplx.priority, "medium");
  assert.match(pplx.actions[0]!, /domains/);
  assert.match(claude.actions[0]!, /Wikipedia/);
  assert.match(pplx.evidence[0]!, /gap 0\.750/);
  assert.equal(recs.some((x) => x.id === "engine-gap-chatgpt"), false);
});

test("recommend: искажённые факты, сомнительные утверждения, негатив", () => {
  const rs = [
    r({ facts: ["Acme was founded in 2010"], sentiment: "negative", claims: ["c1"] }),
    r({ sentiment: "negative", claims: ["c2"] }),
    r({ sentiment: "positive" }),
  ];
  const recs = buildRecommendations(input(rs));
  const byId = Object.fromEntries(recs.map((x) => [x.id, x]));
  assert.equal(byId["contradicted-facts"]!.priority, "high");
  assert.match(byId["contradicted-facts"]!.evidence.join(" "), /Acme was founded in 2010/);
  assert.equal(byId["suspect-claims"]!.priority, "medium");
  assert.equal(byId["negative-sentiment"]!.priority, "high");
  assert.match(byId["negative-sentiment"]!.evidence[0]!, /negativeShare = 0\.667/);
  // Одно сомнительное утверждение — не повод.
  assert.equal(ids(input([r({ claims: ["c1"] })])).includes("suspect-claims"), false);
});

test("recommend: own-citations — high с доменами, medium без", () => {
  const rs = [r({ search: true }), r({ search: true }), r({ engine: "claude" })];
  assert.equal(buildRecommendations(input(rs)).find((x) => x.id === "own-citations")!.priority, "high");
  const noDomains = buildRecommendations(input(rs, { req: { ...req, domains: undefined } })).find((x) => x.id === "own-citations")!;
  assert.equal(noDomains.priority, "medium");
  // Без поисковых движков правило не срабатывает.
  assert.equal(ids(input([r(), r()])).includes("own-citations"), false);
});

test("recommend: share-of-voice — действие «vs» на каждого из топ-3", () => {
  const sov = [
    { name: "Rival1", mentions: 9, share: 0.3 }, { name: "Rival2", mentions: 8, share: 0.25 },
    { name: "Rival3", mentions: 7, share: 0.2 }, { name: "Rival4", mentions: 6, share: 0.15 },
    { name: "Acme", mentions: 3, share: 0.1 },
  ];
  const rec = buildRecommendations(input([r()], { shareOfVoice: sov })).find((x) => x.id === "share-of-voice")!;
  assert.equal(rec.actions.length, 3);
  assert.match(rec.actions[0]!, /"Acme vs Rival1"/);
  assert.match(rec.evidence[0]!, /Acme: 3 mentions/);
});

test("recommend: rank > 3 — low; сортировка high → medium → low", () => {
  const rs = [r({ rank: 5, sentiment: "negative" }), r({ rank: 4, sentiment: "negative" }), r({ mentioned: false }), r({ mentioned: false })];
  const recs = buildRecommendations(input(rs));
  assert.equal(recs.find((x) => x.id === "rank")!.priority, "low");
  const order = { high: 0, medium: 1, low: 2 };
  assert.deepEqual(recs.map((x) => order[x.priority]), [...recs.map((x) => order[x.priority])].sort());
  assert.equal(recs.at(-1)!.id, "rank");
});

test("recommend: token-trust только для токенов, при ≥ 30% плохих trust-ответов", () => {
  const rs = [r({ intent: "trust", mentioned: false }), r({ intent: "trust", sentiment: "negative" }), r({ intent: "trust" }), r({ intent: "trust" })];
  const tokenReq: Requirements = { ...req, subjectType: "token" };
  const rec = buildRecommendations(input(rs, { req: tokenReq })).find((x) => x.id === "token-trust")!;
  assert.equal(rec.priority, "high");
  assert.match(rec.evidence[0]!, /2 of 4 trust answers \(50%\)/);
  assert.equal(ids(input(rs)).includes("token-trust"), false);
  const fine = [r({ intent: "trust" }), r({ intent: "trust" }), r({ intent: "trust" }), r({ intent: "trust", mentioned: false })];
  assert.equal(ids(input(fine, { req: tokenReq })).includes("token-trust"), false);
});

test("recommend: у каждой рекомендации есть actions и evidence", () => {
  const rs = [
    r({ mentioned: false, search: true }), r({ facts: ["f"], claims: ["a"], sentiment: "negative", rank: 6, engine: "claude" }),
    r({ intent: "trust", mentioned: false, claims: ["b"] }),
  ];
  const recs = buildRecommendations(input(rs, { req: { ...req, subjectType: "token", facts: ["f"] }, shareOfVoice: [{ name: "X", mentions: 5, share: 0.8 }, { name: "Acme", mentions: 1, share: 0.2 }] }));
  assert.ok(recs.length >= 5);
  for (const x of recs) {
    assert.ok(x.actions.length && x.evidence.length, x.id);
    assert.ok(x.title && x.why, x.id);
  }
});
