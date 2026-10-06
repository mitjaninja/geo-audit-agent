import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runAudit } from "./audit.js";
import { loadConfig } from "./config.js";
import { buildDeliverable } from "./deliverable.js";
import type { Tier } from "./types.js";
import { validateRequirements } from "./validate.js";

// Локальный аудит вне ACP: npm run audit -- --request examples/brand.json [--tier quick|full] [--out report.json]

const USAGE = "Usage: npm run audit -- --request <file.json> [--tier quick|full] [--out <report.json>]";

async function main() {
  const { values } = parseArgs({
    options: {
      request: { type: "string", short: "r" },
      tier: { type: "string", short: "t", default: "quick" },
      out: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || !values.request) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  const tier = values.tier as Tier;
  if (tier !== "quick" && tier !== "full") throw new Error(`--tier must be quick or full, got "${values.tier}"`);

  const v = validateRequirements(await readFile(values.request, "utf8"));
  if (!v.ok) throw new Error(`Invalid requirement: ${v.error}`);

  const cfg = loadConfig();
  const t0 = Date.now();
  const report = await runAudit(v.value, tier, {
    cfg,
    onProgress: (done, total) => process.stderr.write(`\r${done}/${total} answers`),
    onJudgeError: (e) => process.stderr.write(`\njudge error: ${e instanceof Error ? e.message : String(e)}\n`),
    onUsage: (usage) => {
      process.stderr.write("\n");
      for (const [engine, u] of Object.entries(usage)) {
        process.stderr.write(`tokens ${engine}: ${u.calls} calls, in ${u.inputTokens}, out ${u.outputTokens}\n`);
      }
    },
  });
  const d = await buildDeliverable(report, cfg);
  if (values.out) await writeFile(values.out, JSON.stringify(JSON.parse(d.json), null, 2));

  console.log(report.summaryMarkdown);
  console.log("");
  console.log(`Report: ${d.reportPath}`);
  console.log(`Summary: ${d.summaryPath}`);
  console.log(`Deliverable: ${d.bytes} bytes${d.truncated ? " (evidence truncated)" : ""}${values.out ? ` → ${values.out}` : ""}`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
