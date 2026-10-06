import type { ProbeResult, ScoreBreakdown, Sentiment } from "./types.js";

// GEO-скор строго по формуле из SPEC.md. Текст формулы попадает в отчёт (method.scoring).

export const WEIGHTS = { V: 0.4, R: 0.15, S: 0.15, A: 0.15, C: 0.15 } as const;

export const SCORING_METHOD = [
  "GEO = 100 * (0.40*V + 0.15*R*v + 0.15*S*v + 0.15*A*v + 0.15*C) / sum(weights).",
  "v = share of successful answers that mention the subject; V = 0.6*organicVisibility + 0.4*v (V = v when the group has no discovery answers).",
  "R = mean rank value over mentioning answers: #1 = 1.0, #2 = 0.75, #3 = 0.55, #4 = 0.4, #5+ = 0.3, mentioned outside a list = 0.5.",
  "S = mean sentiment over mentioning answers: positive 1, neutral 0.5, negative 0 (no verdict = 0.5).",
  "A = share of mentioning answers with no contradicted facts and no suspect claims.",
  "C = share of search-engine answers citing the subject's own domains; if there are no search answers, the C term and its weight are dropped.",
  "R, S and A are multiplied by v so an invisible subject cannot score on a few clean answers.",
  "Mention, rank and citations are deterministic (regex); an LLM judge provides only sentiment, fact checks and competitor extraction.",
].join(" ");

export function rankValue(rank: number | null): number {
  if (rank === null) return 0.5;
  if (rank <= 1) return 1;
  if (rank === 2) return 0.75;
  if (rank === 3) return 0.55;
  if (rank === 4) return 0.4;
  return 0.3;
}

const SENTIMENT_VALUE: Record<Sentiment, number> = { positive: 1, neutral: 0.5, negative: 0 };

const round = (x: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
const share = (part: number, total: number) => (total > 0 ? part / total : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function score(results: ProbeResult[]): ScoreBreakdown {
  const ok = results.filter((r) => r.mentioned !== null);
  const failed = results.length - ok.length;
  const hit = ok.filter((r) => r.mentioned === true);
  const discovery = ok.filter((r) => r.probe.intent === "discovery");
  const searchAnswers = ok.filter((r) => r.search);

  const v = share(hit.length, ok.length);
  const organic = share(discovery.filter((r) => r.mentioned).length, discovery.length);
  const V = discovery.length ? 0.6 * organic + 0.4 * v : v;
  const R = mean(hit.map((r) => rankValue(r.rank)));
  const S = mean(hit.map((r) => (r.sentiment ? SENTIMENT_VALUE[r.sentiment] : 0.5)));
  const A = share(hit.filter((r) => r.contradictedFacts.length === 0 && r.suspectClaims.length === 0).length, hit.length);
  const hasSearch = searchAnswers.length > 0;
  const C = share(searchAnswers.filter((r) => r.ownDomainCited).length, searchAnswers.length);

  const sumW = WEIGHTS.V + WEIGHTS.R + WEIGHTS.S + WEIGHTS.A + (hasSearch ? WEIGHTS.C : 0);
  const raw = WEIGHTS.V * V + WEIGHTS.R * R * v + WEIGHTS.S * S * v + WEIGHTS.A * A * v + (hasSearch ? WEIGHTS.C * C : 0);
  const ranks = hit.map((r) => r.rank).filter((x): x is number => x !== null);

  return {
    geoScore: ok.length ? Math.max(0, Math.min(100, Math.round((100 * raw) / sumW))) : 0,
    visibility: round(v, 3),
    organicVisibility: round(organic, 3),
    avgRank: ranks.length ? round(mean(ranks), 2) : null,
    positiveShare: round(share(hit.filter((r) => r.sentiment === "positive").length, hit.length), 3),
    negativeShare: round(share(hit.filter((r) => r.sentiment === "negative").length, hit.length), 3),
    accuracy: round(A, 3),
    citationShare: round(C, 3),
    answers: ok.length,
    failed,
  };
}

/** Тот же расчёт по группам: движкам или интентам. */
export function groupScore(results: ProbeResult[], key: "engine" | "intent"): Record<string, ScoreBreakdown> {
  const groups = new Map<string, ProbeResult[]>();
  for (const r of results) {
    const k = key === "engine" ? r.answer.engine : r.probe.intent;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return Object.fromEntries([...groups].map(([k, rs]) => [k, score(rs)]));
}
