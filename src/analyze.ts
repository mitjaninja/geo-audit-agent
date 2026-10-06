import type { Config } from "./config.js";
import { judgeComplete } from "./engines.js";
import type { EngineAnswer, Probe, ProbeResult, Requirements, Sentiment } from "./types.js";

// Разбор одного ответа. Упоминание, позиция и цитаты — детерминированно (регулярки),
// LLM-судья — только тональность, искажённые факты, сомнительные утверждения и конкуренты.

export const EXCERPT_MAX = 240;
const MAX_SUSPECT_CLAIMS = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** subject + aliases; для `$TICKER` добавляется `TICKER`. Длинные имена первыми. */
export function names(req: Pick<Requirements, "subject" | "aliases">): string[] {
  const out = new Set<string>();
  for (const raw of [req.subject, ...(req.aliases ?? [])]) {
    const n = raw.trim();
    if (!n) continue;
    out.add(n);
    if (n.startsWith("$") && n.length > 1) out.add(n.slice(1));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Регулярка с Unicode-границами: «VIRTUALLY» не матчит «VIRTUAL», «Альфабанк» не матчит «Альфа». */
export function mentionRegex(name: string, flags = "iu"): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(name)})(?=$|[^\\p{L}\\p{N}])`, flags);
}

/** Позиция первого упоминания любого из имён или -1. */
export function firstMention(text: string, nameList: string[]): number {
  let best = -1;
  for (const n of nameList) {
    const m = mentionRegex(n).exec(text);
    if (!m) continue;
    const idx = m.index + (m[1]?.length ?? 0);
    if (best === -1 || idx < best) best = idx;
  }
  return best;
}

export const mentions = (text: string, nameList: string[]) => firstMention(text, nameList) !== -1;

const ITEM_RE = /^( {0,1})(?:\d{1,3}[.)]|[-*•–])\s+(.*)$/;

/**
 * Позиция (с 1) первого пункта списка верхнего уровня (≥ 2 пунктов), где упомянут объект; иначе null.
 * Вложенные строки и подпункты с отступом относятся к текущему пункту, пустые строки список не рвут.
 */
export function listRank(text: string, nameList: string[]): number | null {
  const lists: string[][] = [];
  let current: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const item = ITEM_RE.exec(line);
    if (item) {
      if (!current) lists.push((current = []));
      current.push(item[2] ?? "");
    } else if (!line.trim()) {
      continue;
    } else if (current && /^\s{2,}/.test(line)) {
      current[current.length - 1] += `\n${line.trim()}`;
    } else {
      current = null;
    }
  }
  for (const list of lists) {
    if (list.length < 2) continue;
    const idx = list.findIndex((it) => mentions(it, nameList));
    if (idx !== -1) return idx + 1;
  }
  return null;
}

/** Фрагмент ≤ 240 символов вокруг первого упоминания (или начало ответа). */
export function excerptAround(text: string, at: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_MAX) return flat;
  // Позиция в «сплющенном» тексте: пересчитываем по префиксу.
  const pos = at < 0 ? 0 : text.slice(0, at).replace(/\s+/g, " ").trimStart().length;
  let start = Math.max(0, pos - 80);
  start = Math.min(start, flat.length - (EXCERPT_MAX - 2));
  const body = flat.slice(start, start + EXCERPT_MAX - 2);
  return `${start > 0 ? "…" : ""}${body}${start + body.length < flat.length ? "…" : ""}`.slice(0, EXCERPT_MAX);
}

export function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
}

export function citedDomains(citations: string[]): string[] {
  const out = new Set<string>();
  for (const c of citations) {
    try {
      const host = normalizeDomain(new URL(c).hostname);
      if (host) out.add(host);
    } catch {
      /* не URL — пропускаем */
    }
  }
  return [...out];
}

export function isOwnDomain(domain: string, own: string[]): boolean {
  return own.map(normalizeDomain).filter(Boolean).some((d) => domain === d || domain.endsWith(`.${d}`));
}

// ---------- Судья ----------

export interface JudgeVerdict {
  sentiment: Sentiment | null;
  contradictedFacts: string[];
  suspectClaims: string[];
  competitors: string[];
}

export interface JudgeInput {
  req: Requirements;
  probe: Probe;
  text: string;
  mentioned: boolean;
}

export type Judge = (input: JudgeInput) => Promise<JudgeVerdict>;

export function judgePrompt({ req, probe, text, mentioned }: JudgeInput): string {
  const facts = (req.facts ?? []).map((f, i) => `${i + 1}. ${f}`).join("\n") || "(none)";
  return [
    `Evaluate how an AI assistant's answer portrays the subject "${req.subject}" (${req.subjectType}, category: ${req.category}).`,
    `Known aliases: ${names(req).join(", ")}.`,
    "",
    "Canonical facts (ground truth):",
    facts,
    "",
    `Question asked: ${probe.query}`,
    "Answer:",
    '"""',
    text,
    '"""',
    "",
    "Return a JSON object with exactly these keys:",
    `- "sentiment": "positive" | "neutral" | "negative" — tone toward ${req.subject}${mentioned ? "" : " (use null: the subject is not mentioned)"}.`,
    '- "contradictedFacts": canonical facts the answer explicitly contradicts, copied verbatim from the list above; [] if none.',
    `- "suspectClaims": up to ${MAX_SUSPECT_CLAIMS} specific claims about ${req.subject} that look false or unverifiable; [] if none.`,
    `- "competitors": names of other products, brands, tokens or people the answer presents as alternatives to ${req.subject}; [] if none.`,
  ].join("\n");
}

const SENTIMENTS = new Set<Sentiment>(["positive", "neutral", "negative"]);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean) : []);

/** Разбор ответа судьи с фильтрами из спека. Бросает, если JSON не найден. */
export function parseVerdict(raw: string, req: Requirements): JudgeVerdict {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("judge: no JSON object in reply");
  const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

  const s = typeof obj["sentiment"] === "string" ? (obj["sentiment"].toLowerCase() as Sentiment) : null;
  const facts = new Set(req.facts ?? []);
  const subjectNames = names(req);
  const competitors = [...new Set(strings(obj["competitors"]))].filter((c) => !mentions(c, subjectNames) && !subjectNames.some((n) => mentions(n, [c])));
  return {
    sentiment: s && SENTIMENTS.has(s) ? s : null,
    // Только дословные строки из req.facts — защита от галлюцинаций судьи.
    contradictedFacts: [...new Set(strings(obj["contradictedFacts"]).filter((f) => facts.has(f)))],
    suspectClaims: strings(obj["suspectClaims"]).slice(0, MAX_SUSPECT_CLAIMS),
    competitors,
  };
}

/** Живой судья поверх judgeComplete. */
export function llmJudge(cfg: Config): Judge {
  return async (input) => parseVerdict(await judgeComplete(cfg, judgePrompt(input)), input.req);
}

const NEGATIVE_MARKERS = /\b(risks?|scam|complaints?|avoid|warning)\b|риск|скам|жалоб|осторожн/iu;

/**
 * Офлайн-заглушка судьи для MOCK_ENGINES: тональность по маркерам риска и позиции,
 * сомнительное утверждение при жалобах, конкуренты — жирные пункты списка.
 */
export function mockJudge(): Judge {
  return async ({ req, text, mentioned }) => {
    const subjectNames = names(req);
    const negative = NEGATIVE_MARKERS.test(text);
    const rank = listRank(text, subjectNames);
    const competitors = [...text.matchAll(/\*\*([^*\n]{1,80})\*\*/g)]
      .map((m) => m[1]!.trim())
      .filter((c) => !mentions(c, subjectNames));
    return {
      sentiment: !mentioned ? null : negative ? "negative" : rank !== null && rank <= 2 ? "positive" : "neutral",
      contradictedFacts: [],
      suspectClaims: mentioned && negative ? [`${req.subject} has drawn user complaints`] : [],
      competitors: [...new Set(competitors)],
    };
  };
}

/** Судья по конфигу: заглушка в мок-режиме, живой при наличии ключа, иначе без судьи. */
export function buildJudge(cfg: Config): Judge | null {
  if (cfg.mockEngines) return mockJudge();
  const key = cfg.judge.engine === "openai" ? cfg.openai.apiKey : cfg.anthropic.apiKey;
  return key ? llmJudge(cfg) : null;
}

// ---------- Анализ ----------

export interface AnalyzeOptions {
  search: boolean;
  judge?: Judge | null;
  onJudgeError?: (err: unknown) => void;
}

export async function analyzeAnswer(req: Requirements, probe: Probe, answer: EngineAnswer, opts: AnalyzeOptions): Promise<ProbeResult> {
  const base: ProbeResult = {
    probe, answer, search: opts.search,
    mentioned: null, rank: null, sentiment: null, excerpt: "",
    citedDomains: [], ownDomainCited: false, competitorsMentioned: [], contradictedFacts: [], suspectClaims: [],
  };
  if (answer.error) return base;

  const subjectNames = names(req);
  const at = firstMention(answer.text, subjectNames);
  const mentioned = at !== -1;
  const domains = citedDomains(answer.citations);
  const result: ProbeResult = {
    ...base,
    mentioned,
    rank: mentioned ? listRank(answer.text, subjectNames) : null,
    excerpt: excerptAround(answer.text, at),
    citedDomains: domains,
    ownDomainCited: domains.some((d) => isOwnDomain(d, req.domains ?? [])),
    competitorsMentioned: (req.competitors ?? []).filter((c) => mentions(answer.text, [c])),
  };

  const hasCompetitors = (req.competitors ?? []).length > 0;
  if (opts.judge && (mentioned || !hasCompetitors)) {
    try {
      const v = await opts.judge({ req, probe, text: answer.text, mentioned });
      result.sentiment = mentioned ? v.sentiment : null;
      result.contradictedFacts = mentioned ? v.contradictedFacts : [];
      result.suspectClaims = mentioned ? v.suspectClaims : [];
      if (!hasCompetitors) result.competitorsMentioned = v.competitors;
    } catch (e) {
      // Сбой судьи не роняет аудит — остаётся детерминированная часть.
      opts.onJudgeError?.(e);
    }
  }
  return result;
}
