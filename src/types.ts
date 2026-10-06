// Внутренние типы и внешние контракты (requirements / deliverable) из SPEC.md.
// Контракты меняются только вместе со SPEC.md и schemaVersion.

export type SubjectType = "brand" | "token" | "product" | "protocol" | "person";
export type Lang = "en" | "ru";
export type Tier = "quick" | "full";
export type Intent = "discovery" | "direct" | "comparison" | "trust" | "action" | "custom";
export type Sentiment = "positive" | "neutral" | "negative";

/** Вход сделки — offering/requirements.schema.json (после применения default). */
export interface Requirements {
  subject: string;
  subjectType: SubjectType;
  category: string;
  aliases?: string[];
  domains?: string[];
  competitors?: string[];
  facts?: string[];
  contractAddress?: string;
  languages: Lang[];
  customQueries?: string[];
}

export interface Probe {
  id: string;
  intent: Intent;
  lang: Lang;
  query: string;
  /** Назван ли объект в тексте вопроса (для discovery — false). */
  namesSubject: boolean;
}

export interface EngineAnswer {
  engine: string;
  model: string;
  text: string;
  citations: string[];
  latencyMs: number;
  error?: string;
}

export interface Engine {
  name: string;
  model: string;
  search: boolean;
  ask(prompt: string): Promise<EngineAnswer>;
}

/** Результат анализа одного ответа (вопрос × движок). */
export interface ProbeResult {
  probe: Probe;
  answer: EngineAnswer;
  search: boolean;
  mentioned: boolean | null; // null — движок вернул ошибку
  rank: number | null;
  sentiment: Sentiment | null;
  excerpt: string;
  citedDomains: string[];
  ownDomainCited: boolean;
  competitorsMentioned: string[];
  contradictedFacts: string[];
  suspectClaims: string[];
}

export interface ScoreBreakdown {
  geoScore: number;          // 0–100, целое
  visibility: number;        // доля ответов с упоминанием, 0–1, 3 знака
  organicVisibility: number; // то же, только discovery-вопросы
  avgRank: number | null;    // средняя позиция в списках, 2 знака
  positiveShare: number;     // среди ответов с упоминанием
  negativeShare: number;
  accuracy: number;          // доля ответов с упоминанием без искажений
  citationShare: number;     // доля поисковых ответов со ссылкой на свои домены
  answers: number;           // успешные ответы
  failed: number;            // ошибки движков
}

export type RecommendationArea = "visibility" | "accuracy" | "sentiment" | "citations" | "competition" | "token";

export interface Recommendation {
  id: string;
  priority: "high" | "medium" | "low";
  area: RecommendationArea;
  title: string;
  why: string;
  actions: string[];
  evidence: string[]; // непустой всегда
}

export interface EvidenceRow {
  engine: string;
  intent: string;
  lang: string;
  query: string;
  mentioned: boolean | null;
  rank: number | null;
  sentiment: string | null;
  excerpt: string; // ≤ 240 символов вокруг первого упоминания
  citations: string[];
}

/** Выход сделки — deliverable, schemaVersion "1.0". */
export interface AuditReport {
  schemaVersion: "1.0";
  reportId: string;    // uuid
  generatedAt: string; // ISO
  tier: Tier;
  subject: { subject: string; subjectType: string; category: string };
  method: {
    engines: { engine: string; model: string; search: boolean }[];
    languages: Lang[];
    probes: number;
    scoring: string;
  };
  scores: {
    overall: ScoreBreakdown;
    byEngine: Record<string, ScoreBreakdown>;
    byIntent: Record<string, ScoreBreakdown>;
  };
  shareOfVoice: { name: string; mentions: number; share: number }[]; // по discovery-ответам, топ-12
  issues: {
    contradictedFacts: { fact: string; engine: string; query: string }[];
    suspectClaims: { claim: string; engine: string; query: string }[];
    negativeAnswers: { engine: string; query: string; excerpt: string }[];
  };
  topCitedDomains: { domain: string; count: number }[]; // топ-15
  recommendations: Recommendation[];
  evidence: EvidenceRow[];
  summaryMarkdown: string;
  fullReportUrl?: string;
  evidenceTruncated?: boolean;
}
