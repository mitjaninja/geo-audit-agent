import "dotenv/config";
import type { Tier } from "./types.js";

// Конфиг читается из окружения (.env через dotenv). loadConfig(env) принимает
// произвольный объект, чтобы тесты не зависели от process.env.

export interface EngineConfig {
  apiKey: string;
  model: string;
  webSearch: boolean;
}

export interface Offering {
  tier: Tier;
  name: string;
  price: number; // USDC
}

export interface Config {
  openai: EngineConfig;
  anthropic: EngineConfig;
  perplexity: EngineConfig;
  gemini: EngineConfig;
  judge: { engine: "anthropic" | "openai"; model: string };
  concurrency: number;
  requestTimeoutMs: number;
  acpBin: string;
  offerings: Record<Tier, Offering>;
  stateFile: string;
  reportsDir: string;
  publicReportBaseUrl: string;
  maxInlineDeliverableBytes: number;
  mockEngines: boolean;
}

type Env = Record<string, string | undefined>;

const str = (env: Env, key: string, def = ""): string => {
  const v = env[key]?.trim();
  return v ? v : def;
};

const flag = (env: Env, key: string): boolean => ["1", "true", "yes"].includes(str(env, key).toLowerCase());

const num = (env: Env, key: string, def: number): number => {
  const raw = str(env, key);
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Config: ${key} must be a positive number, got "${raw}"`);
  return n;
};

export function loadConfig(env: Env = process.env): Config {
  const openai: EngineConfig = {
    apiKey: str(env, "OPENAI_API_KEY"),
    model: str(env, "OPENAI_MODEL", "gpt-4o-mini"),
    webSearch: flag(env, "OPENAI_WEB_SEARCH"),
  };
  const anthropic: EngineConfig = {
    apiKey: str(env, "ANTHROPIC_API_KEY"),
    model: str(env, "ANTHROPIC_MODEL", "claude-sonnet-5-5"),
    webSearch: flag(env, "ANTHROPIC_WEB_SEARCH"),
  };
  // Perplexity и Gemini ищут всегда.
  const perplexity: EngineConfig = {
    apiKey: str(env, "PERPLEXITY_API_KEY"),
    model: str(env, "PERPLEXITY_MODEL", "sonar"),
    webSearch: true,
  };
  const gemini: EngineConfig = {
    apiKey: str(env, "GEMINI_API_KEY"),
    model: str(env, "GEMINI_MODEL", "gemini-2.5-flash"),
    webSearch: true,
  };

  const judgeEngine = str(env, "JUDGE_ENGINE", "anthropic").toLowerCase();
  if (judgeEngine !== "anthropic" && judgeEngine !== "openai") {
    throw new Error(`Config: JUDGE_ENGINE must be "anthropic" or "openai", got "${judgeEngine}"`);
  }
  const judgeDefaultModel = judgeEngine === "openai" ? openai.model : anthropic.model;

  return {
    openai,
    anthropic,
    perplexity,
    gemini,
    judge: { engine: judgeEngine, model: str(env, "JUDGE_MODEL", judgeDefaultModel) },
    concurrency: Math.floor(num(env, "CONCURRENCY", 4)),
    requestTimeoutMs: num(env, "REQUEST_TIMEOUT_MS", 60000),
    acpBin: str(env, "ACP_BIN", "acp"),
    offerings: {
      quick: { tier: "quick", name: str(env, "OFFERING_QUICK_NAME", "GEO Audit Quick"), price: num(env, "OFFERING_QUICK_PRICE", 3) },
      full: { tier: "full", name: str(env, "OFFERING_FULL_NAME", "GEO Audit Full"), price: num(env, "OFFERING_FULL_PRICE", 15) },
    },
    stateFile: str(env, "STATE_FILE", "./data/jobs.json"),
    reportsDir: str(env, "REPORTS_DIR", "./data/reports"),
    publicReportBaseUrl: str(env, "PUBLIC_REPORT_BASE_URL"),
    maxInlineDeliverableBytes: Math.floor(num(env, "MAX_INLINE_DELIVERABLE_BYTES", 60000)),
    mockEngines: flag(env, "MOCK_ENGINES"),
  };
}

/** Движки, у которых задан ключ (в мок-режиме — все четыре). */
export function enabledEngines(cfg: Config): ("chatgpt" | "claude" | "perplexity" | "gemini")[] {
  if (cfg.mockEngines) return ["chatgpt", "claude", "perplexity", "gemini"];
  const out: ("chatgpt" | "claude" | "perplexity" | "gemini")[] = [];
  if (cfg.openai.apiKey) out.push("chatgpt");
  if (cfg.anthropic.apiKey) out.push("claude");
  if (cfg.perplexity.apiKey) out.push("perplexity");
  if (cfg.gemini.apiKey) out.push("gemini");
  return out;
}

/** Тариф по описанию сделки (в ACP v2 оно равно имени оффера); иначе quick. */
export function tierByOfferingName(cfg: Config, description: string | undefined): Tier {
  const d = (description ?? "").trim().toLowerCase();
  if (d && d === cfg.offerings.full.name.toLowerCase()) return "full";
  return "quick";
}
