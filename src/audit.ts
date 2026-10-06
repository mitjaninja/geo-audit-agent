import { randomUUID } from "node:crypto";
import { analyzeAnswer, buildJudge, type Judge } from "./analyze.js";
import { loadConfig, type Config } from "./config.js";
import { buildEngines } from "./engines.js";
import { buildProbes } from "./queries.js";
import { buildRecommendations, ENGINE_LABEL } from "./recommend.js";
import { groupScore, score, SCORING_METHOD } from "./scoring.js";
import type { AuditReport, Engine, EvidenceRow, Lang, ProbeResult, Requirements, ScoreBreakdown, Tier } from "./types.js";

// Оркестрация аудита. Про ACP ничего не знает: так же вызывается из CLI.

export interface AuditOptions {
  cfg?: Config;
  engines?: Engine[];
  /** null — без судьи; undefined — по конфигу. */
  judge?: Judge | null;
  onProgress?: (done: number, total: number) => void;
  /** Суммарные токены по движкам — для оценки себестоимости. */
  onUsage?: (usage: Record<string, { inputTokens: number; outputTokens: number; calls: number }>) => void;
  onJudgeError?: (err: unknown) => void;
}

const TOP_SOV = 12;
const TOP_DOMAINS = 15;
const TOP_ACTIONS = 5;

/** Пул: выполняет задачи с ограничением параллельности, сохраняя порядок результатов. */
export async function pool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return out;
}

function computeShareOfVoice(req: Requirements, results: ProbeResult[]) {
  const ok = results.filter((r) => r.mentioned !== null);
  const discovery = ok.filter((r) => r.probe.intent === "discovery");
  const base = discovery.length ? discovery : ok;
  const counts = new Map<string, number>([[req.subject, 0]]);
  for (const r of base) {
    if (r.mentioned) counts.set(req.subject, (counts.get(req.subject) ?? 0) + 1);
    for (const c of new Set(r.competitorsMentioned)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const rows = [...counts].map(([name, mentions]) => ({ name, mentions, share: total ? Math.round((mentions / total) * 1000) / 1000 : 0 }));
  rows.sort((a, b) => b.mentions - a.mentions || (a.name === req.subject ? -1 : b.name === req.subject ? 1 : a.name.localeCompare(b.name)));
  const top = rows.slice(0, TOP_SOV);
  // Объект всегда в таблице, даже если не попал в топ.
  if (!top.some((x) => x.name === req.subject)) top[top.length - 1] = rows.find((x) => x.name === req.subject)!;
  return top;
}

function topDomains(results: ProbeResult[]) {
  const counts = new Map<string, number>();
  for (const r of results) for (const d of r.citedDomains) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts].map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, TOP_DOMAINS);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function summaryMarkdown(report: Omit<AuditReport, "summaryMarkdown">): string {
  const o = report.scores.overall;
  const lines = [
    `# GEO audit: ${report.subject.subject}`,
    "",
    `**GEO score: ${o.geoScore}/100** · visibility ${pct(o.visibility)} · organic visibility ${pct(o.organicVisibility)} · avg rank ${o.avgRank ?? "n/a"} · positive ${pct(o.positiveShare)} · negative ${pct(o.negativeShare)} · accuracy ${pct(o.accuracy)} · own-domain citations ${pct(o.citationShare)}`,
    "",
    `Tier: ${report.tier} · ${report.subject.subjectType} in "${report.subject.category}" · ${report.method.probes} answers from ${report.method.engines.length} engines · languages: ${report.method.languages.join(", ")} · failed calls: ${o.failed} · ${report.generatedAt}`,
    "",
    "## By engine",
    "",
    "| Engine | GEO | Visibility | Organic | Avg rank | Positive | Negative | Citations | Answers | Failed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...Object.entries(report.scores.byEngine).map(([e, b]) =>
      `| ${ENGINE_LABEL[e] ?? e} | ${b.geoScore} | ${pct(b.visibility)} | ${pct(b.organicVisibility)} | ${b.avgRank ?? "n/a"} | ${pct(b.positiveShare)} | ${pct(b.negativeShare)} | ${report.method.engines.find((x) => x.engine === e)?.search ? pct(b.citationShare) : "—"} | ${b.answers} | ${b.failed} |`),
    "",
    "## Share of voice (discovery answers)",
    "",
    ...report.shareOfVoice.slice(0, 8).map((x) => `- ${x.name === report.subject.subject ? `**${x.name}**` : x.name}: ${x.mentions} mentions (${pct(x.share)})`),
    "",
    "## Top actions",
    "",
    ...(report.recommendations.length
      ? report.recommendations.slice(0, TOP_ACTIONS).map((r, i) => `${i + 1}. **[${r.priority.toUpperCase()}] ${r.title}.** ${r.actions[0]} _(${r.evidence[0]})_`)
      : ["No issues crossed the recommendation thresholds."]),
  ];
  return lines.join("\n");
}

export async function runAudit(req: Requirements, tier: Tier, opts: AuditOptions = {}): Promise<AuditReport> {
  const cfg = opts.cfg ?? loadConfig();
  const engines = opts.engines ?? buildEngines(cfg, req);
  if (!engines.length) throw new Error("No engines enabled: set at least one API key or MOCK_ENGINES=1");
  const judge = opts.judge !== undefined ? opts.judge : buildJudge(cfg);
  const probes = buildProbes(req, tier);

  let done = 0;
  const total = probes.length * engines.length;
  const tasks = probes.flatMap((probe) => engines.map((engine) => async () => {
    const answer = await engine.ask(probe.query);
    const r = await analyzeAnswer(req, probe, answer, { search: engine.search, judge, onJudgeError: opts.onJudgeError });
    opts.onProgress?.(++done, total);
    return r;
  }));
  const results = await pool(tasks, cfg.concurrency);

  const failed = results.filter((r) => r.mentioned === null);
  if (failed.length === results.length) {
    const first = [...new Set(failed.map((r) => `${r.answer.engine}: ${r.answer.error}`))].slice(0, 3);
    throw new Error(`All ${results.length} engine calls failed: ${first.join(" | ")}`);
  }

  if (opts.onUsage) {
    const usage: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};
    for (const r of results) {
      const u = (usage[r.answer.engine] ??= { inputTokens: 0, outputTokens: 0, calls: 0 });
      u.calls++;
      u.inputTokens += r.answer.usage?.inputTokens ?? 0;
      u.outputTokens += r.answer.usage?.outputTokens ?? 0;
    }
    opts.onUsage(usage);
  }

  const overall: ScoreBreakdown = score(results);
  const byEngine = groupScore(results, "engine");
  const byIntent = groupScore(results, "intent");
  const shareOfVoice = computeShareOfVoice(req, results);
  const topCitedDomains = topDomains(results);
  const recommendations = buildRecommendations({ req, results, overall, byEngine, shareOfVoice, topCitedDomains });

  const evidence: EvidenceRow[] = results.map((r) => ({
    engine: r.answer.engine,
    intent: r.probe.intent,
    lang: r.probe.lang,
    query: r.probe.query,
    mentioned: r.mentioned,
    rank: r.rank,
    sentiment: r.sentiment,
    excerpt: r.mentioned === null ? `ERROR: ${r.answer.error ?? "unknown"}`.slice(0, 240) : r.excerpt,
    citations: r.answer.citations,
  }));

  const languages = [...new Set(probes.map((p) => p.lang))] as Lang[];
  const report: Omit<AuditReport, "summaryMarkdown"> = {
    schemaVersion: "1.0",
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),
    tier,
    subject: { subject: req.subject, subjectType: req.subjectType, category: req.category },
    method: {
      engines: engines.map((e) => ({ engine: e.name, model: e.model, search: e.search })),
      languages,
      probes: results.length,
      scoring: SCORING_METHOD,
    },
    scores: { overall, byEngine, byIntent },
    shareOfVoice,
    issues: {
      contradictedFacts: results.flatMap((r) => r.contradictedFacts.map((fact) => ({ fact, engine: r.answer.engine, query: r.probe.query }))),
      suspectClaims: results.flatMap((r) => r.suspectClaims.map((claim) => ({ claim, engine: r.answer.engine, query: r.probe.query }))),
      negativeAnswers: results.filter((r) => r.sentiment === "negative").map((r) => ({ engine: r.answer.engine, query: r.probe.query, excerpt: r.excerpt })),
    },
    topCitedDomains,
    recommendations,
    evidence,
  };
  return { ...report, summaryMarkdown: summaryMarkdown(report) };
}
