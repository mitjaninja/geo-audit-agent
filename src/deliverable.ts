import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { AuditReport } from "./types.js";

// Deliverable передаётся аргументом командной строки acp-cli, поэтому inline-JSON держим
// не больше MAX_INLINE_DELIVERABLE_BYTES; полный отчёт всегда лежит в REPORTS_DIR.

export interface DeliverableResult {
  json: string;
  bytes: number;
  truncated: boolean;
  reportPath: string;
  summaryPath: string;
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

export async function buildDeliverable(report: AuditReport, cfg: Pick<Config, "reportsDir" | "publicReportBaseUrl" | "maxInlineDeliverableBytes">): Promise<DeliverableResult> {
  const full: AuditReport = { ...report };
  if (cfg.publicReportBaseUrl) full.fullReportUrl = `${cfg.publicReportBaseUrl.replace(/\/+$/, "")}/${report.reportId}.json`;

  await mkdir(cfg.reportsDir, { recursive: true });
  const reportPath = join(cfg.reportsDir, `${report.reportId}.json`);
  const summaryPath = join(cfg.reportsDir, `${report.reportId}.md`);
  await writeFile(reportPath, JSON.stringify(full, null, 2));
  await writeFile(summaryPath, `${full.summaryMarkdown}\n`);

  const limit = cfg.maxInlineDeliverableBytes;
  let json = JSON.stringify(full);
  if (bytes(json) <= limit) return { json, bytes: bytes(json), truncated: false, reportPath, summaryPath };

  // Урезаем evidence: сначала оставляем строки с упоминанием, затем остальные, в исходном порядке.
  const order = full.evidence
    .map((row, i) => ({ row, i }))
    .sort((a, b) => Number(b.row.mentioned === true) - Number(a.row.mentioned === true) || a.i - b.i);
  const build = (keep: number) => {
    const kept = order.slice(0, keep).sort((a, b) => a.i - b.i).map((x) => x.row);
    return JSON.stringify({ ...full, evidence: kept, evidenceTruncated: true });
  };
  // Бинарный поиск максимального числа строк, которое влезает в лимит.
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytes(build(mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  json = build(lo);
  if (bytes(json) > limit) {
    throw new Error(`Deliverable does not fit ${limit} bytes even without evidence (${bytes(json)} bytes)`);
  }
  return { json, bytes: bytes(json), truncated: true, reportPath, summaryPath };
}
