import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mockJudge } from "../src/analyze.js";
import { pool, runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { buildDeliverable } from "../src/deliverable.js";
import { mockEngines } from "../src/engines.js";
import { buildProbes } from "../src/queries.js";
import type { AuditReport, Engine, Requirements } from "../src/types.js";
import { validateRequirements } from "../src/validate.js";

const REPORTS_DIR = "./data/test/reports-audit";
const cfg = loadConfig({ MOCK_ENGINES: "1", CONCURRENCY: "4", REPORTS_DIR });
const load = (name: string): Requirements => {
  const r = validateRequirements(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"));
  assert.ok(r.ok);
  return r.value;
};
const token = load("token.json");
const brand = load("brand.json");

function checkInvariants(report: AuditReport, req: Requirements) {
  assert.equal(report.schemaVersion, "1.0");
  assert.match(report.reportId, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
  assert.deepEqual(report.subject, { subject: req.subject, subjectType: req.subjectType, category: req.category });
  assert.equal(report.evidence.length, report.method.probes);

  // visibility пересчитывается из evidence.
  const ok = report.evidence.filter((e) => e.mentioned !== null);
  const v = Math.round((ok.filter((e) => e.mentioned).length / ok.length) * 1000) / 1000;
  assert.equal(report.scores.overall.visibility, v);
  assert.equal(report.scores.overall.answers, ok.length);

  for (const e of report.evidence) assert.ok(e.excerpt.length <= 240);
  for (const r of report.recommendations) {
    assert.ok(r.actions.length > 0, r.id);
    assert.ok(r.evidence.length > 0, r.id);
  }
  const pr = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < report.recommendations.length; i++) {
    assert.ok(pr[report.recommendations[i - 1]!.priority] <= pr[report.recommendations[i]!.priority]);
  }
  assert.match(report.summaryMarkdown, new RegExp(`GEO score: ${report.scores.overall.geoScore}/100`));
  assert.ok(report.scores.overall.geoScore >= 0 && report.scores.overall.geoScore <= 100);
  assert.ok(report.shareOfVoice.length <= 12 && report.shareOfVoice.some((x) => x.name === req.subject));
  assert.ok(report.topCitedDomains.length <= 15);
  assert.ok(report.method.scoring.includes("GEO ="));
}

test("audit: полный прогон на моках — 4 движка и инварианты отчёта", async () => {
  for (const [req, tier] of [[token, "quick"], [token, "full"], [brand, "quick"]] as const) {
    let progress = 0;
    const report = await runAudit(req, tier, { cfg, onProgress: (d) => (progress = d) });
    assert.equal(report.method.engines.length, 4);
    assert.equal(report.method.probes, buildProbes(req, tier).length * 4);
    assert.equal(progress, report.method.probes);
    assert.equal(report.tier, tier);
    assert.deepEqual(report.method.languages, ["en", "ru"]);
    assert.deepEqual(Object.keys(report.scores.byEngine), ["chatgpt", "claude", "perplexity", "gemini"]);
    assert.ok("discovery" in report.scores.byIntent);
    checkInvariants(report, req);
  }
});

test("audit: порядок evidence детерминирован — вопросы × движки", async () => {
  const a = await runAudit(brand, "quick", { cfg });
  const b = await runAudit(brand, "quick", { cfg: { ...cfg, concurrency: 1 } });
  assert.deepEqual(a.evidence, b.evidence);
  assert.deepEqual(a.scores, b.scores);
  assert.deepEqual(a.evidence.slice(0, 4).map((e) => e.engine), ["chatgpt", "claude", "perplexity", "gemini"]);
});

test("audit: часть движков упала — отчёт есть, failed посчитан", async () => {
  const broken: Engine = { name: "broken", model: "x", search: false, ask: async () => ({ engine: "broken", model: "x", text: "", citations: [], latencyMs: 0, error: "HTTP 500" }) };
  const report = await runAudit(brand, "quick", { cfg, engines: [...mockEngines(brand.subject, brand.competitors), broken], judge: mockJudge() });
  const n = buildProbes(brand, "quick").length;
  assert.equal(report.scores.overall.failed, n);
  assert.equal(report.scores.byEngine["broken"]!.answers, 0);
  assert.equal(report.evidence.filter((e) => e.mentioned === null).length, n);
  checkInvariants(report, brand);
});

test("audit: все вызовы упали — исключение с первыми ошибками", async () => {
  const broken: Engine = { name: "broken", model: "x", search: false, ask: async () => ({ engine: "broken", model: "x", text: "", citations: [], latencyMs: 0, error: "HTTP 401: bad key" }) };
  await assert.rejects(runAudit(brand, "quick", { cfg, engines: [broken] }), /All \d+ engine calls failed: broken: HTTP 401/);
  await assert.rejects(runAudit(brand, "quick", { cfg: loadConfig({}) }), /No engines enabled/);
});

test("audit: без судьи аудит идёт на детерминированной части", async () => {
  const report = await runAudit(brand, "quick", { cfg, judge: null });
  assert.ok(report.evidence.every((e) => e.sentiment === null));
  checkInvariants(report, brand);
});

test("audit: токены по движкам", async () => {
  let usage: Record<string, { calls: number }> = {};
  await runAudit(brand, "quick", { cfg, onUsage: (u) => (usage = u) });
  assert.equal(usage["claude"]!.calls, buildProbes(brand, "quick").length);
});

test("deliverable: пишет отчёт и сводку, inline ≤ лимита без урезания", async () => {
  await rm(REPORTS_DIR, { recursive: true, force: true });
  const report = await runAudit(token, "quick", { cfg });
  const d = await buildDeliverable(report, { ...cfg, publicReportBaseUrl: "https://reports.example.com/" });
  assert.equal(d.truncated, false);
  assert.ok(d.bytes <= cfg.maxInlineDeliverableBytes);
  const parsed = JSON.parse(d.json) as AuditReport;
  assert.equal(parsed.fullReportUrl, `https://reports.example.com/${report.reportId}.json`);
  assert.equal(parsed.evidenceTruncated, undefined);
  const saved = JSON.parse(await readFile(d.reportPath, "utf8")) as AuditReport;
  assert.equal(saved.evidence.length, report.method.probes);
  assert.match(await readFile(d.summaryPath, "utf8"), /GEO score: \d+\/100/);
});

test("deliverable: при превышении лимита урезает evidence, сначала оставляя упоминания", async () => {
  const report = await runAudit(token, "full", { cfg });
  const limit = 30_000;
  const d = await buildDeliverable(report, { ...cfg, maxInlineDeliverableBytes: limit });
  assert.equal(d.truncated, true);
  assert.ok(d.bytes <= limit, String(d.bytes));
  const parsed = JSON.parse(d.json) as AuditReport;
  assert.equal(parsed.evidenceTruncated, true);
  assert.ok(parsed.evidence.length < report.evidence.length && parsed.evidence.length > 0);
  const mentionedTotal = report.evidence.filter((e) => e.mentioned).length;
  const kept = parsed.evidence.length;
  // Строки без упоминания попадают, только когда все строки с упоминанием уже вошли.
  if (kept <= mentionedTotal) assert.ok(parsed.evidence.every((e) => e.mentioned === true));
  // Полный отчёт на диске не урезан.
  const saved = JSON.parse(await readFile(d.reportPath, "utf8")) as AuditReport;
  assert.equal(saved.evidence.length, report.evidence.length);
  await assert.rejects(buildDeliverable(report, { ...cfg, maxInlineDeliverableBytes: 100 }), /does not fit/);
});

test("pool: ограничивает параллельность и сохраняет порядок", async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 10 }, (_, i) => async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5 - (i % 3)));
    active--;
    return i;
  });
  assert.deepEqual(await pool(tasks, 3), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(peak <= 3);
});
