import { test } from "node:test";
import assert from "node:assert/strict";
import { groupScore, rankValue, score, SCORING_METHOD } from "../src/scoring.js";
import type { Intent, ProbeResult, Sentiment } from "../src/types.js";

interface Opts {
  engine?: string;
  intent?: Intent;
  mentioned?: boolean | null;
  rank?: number | null;
  sentiment?: Sentiment | null;
  search?: boolean;
  own?: boolean;
  bad?: boolean;
}
function r(o: Opts = {}): ProbeResult {
  const intent = o.intent ?? "discovery";
  return {
    probe: { id: "x", intent, lang: "en", query: "q", namesSubject: intent !== "discovery" },
    answer: { engine: o.engine ?? "chatgpt", model: "m", text: "t", citations: [], latencyMs: 1, ...(o.mentioned === null ? { error: "e" } : {}) },
    search: o.search ?? false,
    mentioned: o.mentioned === undefined ? true : o.mentioned,
    rank: o.rank ?? null,
    sentiment: o.sentiment === undefined ? (o.mentioned === false ? null : "positive") : o.sentiment,
    excerpt: "",
    citedDomains: [],
    ownDomainCited: o.own ?? false,
    competitorsMentioned: [],
    contradictedFacts: o.bad ? ["f"] : [],
    suspectClaims: [],
  };
}

test("scoring: невидимый объект — 1 упоминание из 4 → < 25, organicVisibility = 0", () => {
  const s = score([
    r({ intent: "discovery", mentioned: false }),
    r({ intent: "discovery", mentioned: false }),
    r({ intent: "discovery", mentioned: false }),
    r({ intent: "direct", mentioned: true, rank: 1, sentiment: "positive" }),
  ]);
  assert.ok(s.geoScore < 25, String(s.geoScore));
  assert.equal(s.organicVisibility, 0);
  assert.equal(s.visibility, 0.25);
});

test("scoring: 1 из 4 даже в лучшем раскладе и с поиском → < 25", () => {
  const s = score([
    r({ intent: "discovery", mentioned: false, search: true }),
    r({ intent: "discovery", mentioned: false, search: true }),
    r({ intent: "discovery", mentioned: false, search: true }),
    r({ intent: "direct", mentioned: true, rank: 1, search: true }),
  ]);
  assert.ok(s.geoScore < 25, String(s.geoScore));
});

test("scoring: 4 из 4 с позитивом → > 80", () => {
  const s = score([1, 2, 1, 1].map((rank) => r({ rank, sentiment: "positive" })));
  assert.ok(s.geoScore > 80, String(s.geoScore));
  assert.equal(s.visibility, 1);
  assert.equal(s.organicVisibility, 1);
  assert.equal(s.avgRank, 1.25);
  assert.equal(s.positiveShare, 1);
  assert.equal(s.accuracy, 1);
});

test("scoring: точное значение по формуле (без поиска вес C убирается)", () => {
  // v = 0.5, organic = 0.5 → V = 0.5; R = mean(1, 0.5) = 0.75; S = mean(1, 0) = 0.5; A = 0.5.
  const s = score([
    r({ rank: 1, sentiment: "positive" }),
    r({ rank: null, sentiment: "negative", bad: true }),
    r({ mentioned: false }),
    r({ mentioned: false }),
  ]);
  const expected = Math.round((100 * (0.4 * 0.5 + 0.15 * 0.75 * 0.5 + 0.15 * 0.5 * 0.5 + 0.15 * 0.5 * 0.5)) / 0.85);
  assert.equal(s.geoScore, expected);
  assert.equal(s.negativeShare, 0.5);
  assert.equal(s.accuracy, 0.5);
  assert.equal(s.avgRank, 1);
});

test("scoring: цитаты своих доменов только по поисковым ответам", () => {
  const s = score([
    r({ search: true, own: true }),
    r({ search: true, own: false }),
    r({ search: false, own: true }),
  ]);
  assert.equal(s.citationShare, 0.5);
  const noSearch = score([r({ search: false })]);
  const withSearch = score([r({ search: true, own: false })]);
  assert.ok(noSearch.geoScore > withSearch.geoScore);
});

test("scoring: ошибки движков не входят в знаменатель", () => {
  const s = score([r(), r({ mentioned: null }), r({ mentioned: null })]);
  assert.equal(s.answers, 1);
  assert.equal(s.failed, 2);
  assert.equal(s.visibility, 1);
  const allFailed = score([r({ mentioned: null })]);
  assert.equal(allFailed.geoScore, 0);
  assert.equal(allFailed.answers, 0);
  assert.equal(allFailed.avgRank, null);
});

test("scoring: ценность позиции", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9, null].map(rankValue), [1, 0.75, 0.55, 0.4, 0.3, 0.3, 0.5]);
});

test("scoring: группа без discovery — V = v", () => {
  const s = score([r({ intent: "direct" }), r({ intent: "direct", mentioned: false })]);
  assert.equal(s.organicVisibility, 0);
  // V = v = 0.5, R = 0.5, S = 1, A = 1 → (0.2 + 0.0375 + 0.075 + 0.075) / 0.85
  assert.equal(s.geoScore, Math.round((100 * (0.2 + 0.15 * 0.5 * 0.5 + 0.15 * 0.5 + 0.15 * 0.5)) / 0.85));
});

test("scoring: groupScore по движкам и интентам, формула в SCORING_METHOD", () => {
  const rs = [r({ engine: "chatgpt" }), r({ engine: "claude", mentioned: false }), r({ engine: "claude", intent: "trust" })];
  const byEngine = groupScore(rs, "engine");
  assert.deepEqual(Object.keys(byEngine), ["chatgpt", "claude"]);
  assert.equal(byEngine["claude"]!.answers, 2);
  const byIntent = groupScore(rs, "intent");
  assert.deepEqual(Object.keys(byIntent).sort(), ["discovery", "trust"]);
  assert.match(SCORING_METHOD, /0\.40\*V/);
});
