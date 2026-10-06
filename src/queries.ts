import type { Intent, Lang, Probe, Requirements, SubjectType, Tier } from "./types.js";

// Набор вопросов к движкам. Формулировки — как спрашивают живые люди, не SEO-ключи.
// Плейсхолдеры: {s} объект, {c} категория, {comp} первый конкурент, {ca} контракт.
// Шаблон с {comp} / {ca} пропускается, если поля нет; шаблон с types — только для этих типов.

interface Template {
  id: string;
  intent: Exclude<Intent, "custom">;
  text: string;
  types?: SubjectType[];
}

const ORG: SubjectType[] = ["brand", "token", "product", "protocol"];
const BUILT: SubjectType[] = ["token", "product", "protocol"];

// Внутри интента порядок важен: Quick берёт первые подходящие шаблоны.
const TEMPLATES: Record<Lang, Template[]> = {
  en: [
    { id: "d1", intent: "discovery", text: "What are the best {c} right now?" },
    { id: "d2", intent: "discovery", text: "Which {c} would you recommend for someone just getting started?" },
    { id: "d3", intent: "discovery", text: "What are the top {c} people are talking about lately?" },
    { id: "d4", intent: "discovery", text: "I'm choosing between {c}. Which ones are worth a look and why?" },

    { id: "r1", intent: "direct", text: "What is {s}?", types: ORG },
    { id: "r2", intent: "direct", text: "Who is {s} and what are they known for?", types: ["person"] },
    { id: "r3", intent: "direct", text: "How does {s} actually work?", types: BUILT },
    { id: "r4", intent: "direct", text: "Can you explain {s} tokenomics: supply, utility and who holds it?", types: ["token"] },
    { id: "r5", intent: "direct", text: "What do people generally say about {s}?" },

    { id: "c1", intent: "comparison", text: "{s} vs {comp}: which one is better?" },
    { id: "c2", intent: "comparison", text: "What are the best alternatives to {s}?" },

    { id: "t1", intent: "trust", text: "Is {ca} the official contract address of {s}?", types: ["token"] },
    { id: "t2", intent: "trust", text: "Is {s} legit or a scam?", types: ORG },
    { id: "t3", intent: "trust", text: "Can {s} be trusted? Any controversies I should know about?", types: ["person"] },
    { id: "t4", intent: "trust", text: "What are the main risks of using {s}?", types: ORG },

    { id: "a1", intent: "action", text: "Where and how can I buy {s}?", types: ["token"] },
    { id: "a2", intent: "action", text: "How do I get started with {s}?", types: ["brand", "product", "protocol"] },
    { id: "a3", intent: "action", text: "How can I follow or get in touch with {s}?", types: ["person"] },
    { id: "a4", intent: "action", text: "Should I go with {s} if I need {c}?", types: ORG },
  ],
  ru: [
    { id: "d1", intent: "discovery", text: "Какие {c} сейчас лучшие?" },
    { id: "d2", intent: "discovery", text: "Что посоветуешь из {c} новичку?" },
    { id: "d3", intent: "discovery", text: "Какие {c} сейчас у всех на слуху?" },
    { id: "d4", intent: "discovery", text: "Выбираю среди {c}. На что стоит посмотреть и почему?" },

    { id: "r1", intent: "direct", text: "Что такое {s}?", types: ORG },
    { id: "r2", intent: "direct", text: "Кто такой {s} и чем известен?", types: ["person"] },
    { id: "r3", intent: "direct", text: "Как на самом деле работает {s}?", types: BUILT },
    { id: "r4", intent: "direct", text: "Объясни токеномику {s}: эмиссия, зачем нужен токен и у кого он.", types: ["token"] },
    { id: "r5", intent: "direct", text: "Что вообще говорят про {s}?" },

    { id: "c1", intent: "comparison", text: "{s} или {comp} — что лучше?" },
    { id: "c2", intent: "comparison", text: "Какие есть альтернативы {s}?" },

    { id: "t1", intent: "trust", text: "{ca} — это официальный контракт {s}?", types: ["token"] },
    { id: "t2", intent: "trust", text: "{s} — это надёжно или скам?", types: ORG },
    { id: "t3", intent: "trust", text: "Можно ли доверять {s}? Были ли скандалы?", types: ["person"] },
    { id: "t4", intent: "trust", text: "Какие главные риски у {s}?", types: ORG },

    { id: "a1", intent: "action", text: "Где и как купить {s}?", types: ["token"] },
    { id: "a2", intent: "action", text: "С чего начать, если хочу попробовать {s}?", types: ["brand", "product", "protocol"] },
    { id: "a3", intent: "action", text: "Как следить за {s} или связаться с ним?", types: ["person"] },
    { id: "a4", intent: "action", text: "Стоит ли выбрать {s}, если мне нужны {c}?", types: ORG },
  ],
};

/** Состав Quick на язык: 2 discovery + по одному direct, trust, comparison, action. */
const QUICK_PLAN: [Exclude<Intent, "custom">, number][] = [
  ["discovery", 2],
  ["direct", 1],
  ["trust", 1],
  ["comparison", 1],
  ["action", 1],
];
const INTENT_ORDER: Exclude<Intent, "custom">[] = ["discovery", "direct", "comparison", "trust", "action"];
export const QUICK_PER_LANG = 6;
export const FULL_PER_LANG = 16;

const CYRILLIC = /\p{Script=Cyrillic}/u;
export const detectLang = (text: string): Lang => (CYRILLIC.test(text) ? "ru" : "en");

function fill(t: Template, req: Requirements): string | null {
  const comp = req.competitors?.[0];
  const ca = req.contractAddress?.trim();
  if (t.text.includes("{comp}") && !comp) return null;
  if (t.text.includes("{ca}") && !ca) return null;
  return t.text
    .replaceAll("{s}", req.subject)
    .replaceAll("{c}", req.category)
    .replaceAll("{comp}", comp ?? "")
    .replaceAll("{ca}", ca ?? "");
}

function namesSubject(query: string, req: Requirements): boolean {
  const q = query.toLowerCase();
  return [req.subject, ...(req.aliases ?? [])]
    .flatMap((n) => (n.startsWith("$") ? [n, n.slice(1)] : [n]))
    .some((n) => n.length > 0 && q.includes(n.toLowerCase()));
}

export function buildProbes(req: Requirements, tier: Tier): Probe[] {
  const probes: Probe[] = [];
  const seen = new Set<string>();
  const push = (p: Probe) => {
    const key = p.query.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    probes.push(p);
  };

  for (const lang of req.languages) {
    const applicable = TEMPLATES[lang]
      .filter((t) => !t.types || t.types.includes(req.subjectType))
      .map((t) => ({ t, query: fill(t, req) }))
      .filter((x): x is { t: Template; query: string } => x.query !== null);

    const byIntent = (intent: Intent) => applicable.filter((x) => x.t.intent === intent);
    const picked =
      tier === "quick"
        ? QUICK_PLAN.flatMap(([intent, n]) => byIntent(intent).slice(0, n)).slice(0, QUICK_PER_LANG)
        : INTENT_ORDER.flatMap((intent) => byIntent(intent)).slice(0, FULL_PER_LANG);

    for (const { t, query } of picked) {
      push({ id: `${lang}.${t.id}`, intent: t.intent, lang, query, namesSubject: t.text.includes("{s}") });
    }
  }

  // Свои вопросы клиента — в любом тарифе, язык по кириллице.
  (req.customQueries ?? []).forEach((raw, i) => {
    const query = raw.trim();
    if (!query) return;
    push({ id: `custom.${i + 1}`, intent: "custom", lang: detectLang(query), query, namesSubject: namesSubject(query, req) });
  });

  return probes;
}
