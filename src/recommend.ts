import type { ProbeResult, Recommendation, Requirements, ScoreBreakdown } from "./types.js";

// Рекомендации срабатывают только на измеренных данных; у каждой в evidence — цифры, на которых она основана.

export interface RecommendInput {
  req: Requirements;
  results: ProbeResult[];
  overall: ScoreBreakdown;
  byEngine: Record<string, ScoreBreakdown>;
  shareOfVoice: { name: string; mentions: number; share: number }[];
  topCitedDomains: { domain: string; count: number }[];
}

export const ENGINE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" };
const label = (e: string) => ENGINE_LABEL[e] ?? e;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const f3 = (x: number) => x.toFixed(3);
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const MAX_EXAMPLES = 5;

export function buildRecommendations(input: RecommendInput): Recommendation[] {
  const { req, results, overall, byEngine, shareOfVoice, topCitedDomains } = input;
  const s = req.subject;
  const c = req.category;
  const ok = results.filter((r) => r.mentioned !== null);
  const recs: Recommendation[] = [];

  // organic-visibility
  const discovery = ok.filter((r) => r.probe.intent === "discovery");
  if (discovery.length && overall.organicVisibility < 0.3) {
    const hits = discovery.filter((r) => r.mentioned).length;
    recs.push({
      id: "organic-visibility", priority: "high", area: "visibility",
      title: `${s} is rarely recommended when users ask about ${c} without naming it`,
      why: "Unbranded discovery questions are how new users find options; being absent there means AI assistants do not consider the subject a leading choice.",
      actions: [
        `Publish a clear, crawlable page that positions ${s} within "${c}" using the same wording users ask with.`,
        `Get ${s} included in third-party "best ${c}" lists, reviews and comparisons that AI engines cite.`,
        "Keep the name and one-line description consistent across your site, docs, social profiles, Wikipedia/Wikidata and directories.",
      ],
      evidence: [
        `organicVisibility = ${f3(overall.organicVisibility)} (${hits} of ${discovery.length} discovery answers mention ${s}); threshold 0.30`,
        ...discovery.filter((r) => !r.mentioned).slice(0, 3).map((r) => `${label(r.answer.engine)} did not mention ${s} for: "${r.probe.query}"`),
      ],
    });
  }

  // engine-gap-<engine>
  const engines = Object.entries(byEngine).filter(([, b]) => b.answers > 0);
  if (engines.length > 1) {
    const bestV = engines.reduce((a, b) => (b[1].visibility > a[1].visibility ? b : a));
    const bestO = engines.reduce((a, b) => (b[1].organicVisibility > a[1].organicVisibility ? b : a));
    for (const [engine, b] of engines) {
      const gapV = bestV[1].visibility - b.visibility;
      const gapO = bestO[1].organicVisibility - b.organicVisibility;
      if (gapV < 0.25 && gapO < 0.3) continue;
      const search = results.some((r) => r.answer.engine === engine && r.search);
      const evidence: string[] = [];
      if (gapV >= 0.25) evidence.push(`${label(engine)} visibility ${f3(b.visibility)} vs ${label(bestV[0])} ${f3(bestV[1].visibility)} (gap ${f3(gapV)}; threshold 0.25)`);
      if (gapO >= 0.3) evidence.push(`${label(engine)} organicVisibility ${f3(b.organicVisibility)} vs ${label(bestO[0])} ${f3(bestO[1].organicVisibility)} (gap ${f3(gapO)}; threshold 0.30)`);
      recs.push({
        id: `engine-gap-${engine}`, priority: "medium", area: "visibility",
        title: `${label(engine)} mentions ${s} noticeably less than other engines`,
        why: search
          ? `${label(engine)} answers from live web results, so the gap reflects which pages its search surfaces for these questions.`
          : `${label(engine)} answers mostly from training data, so the gap reflects how well ${s} is represented in widely published sources.`,
        actions: search
          ? [
              `Check which domains ${label(engine)} cites for ${c} questions (see topCitedDomains) and get ${s} covered on them.`,
              `Publish up-to-date, well-structured pages (FAQ, comparisons, docs) that answer these questions directly and are easy to quote.`,
            ]
          : [
              `Strengthen ${s}'s footprint in durable, widely mirrored sources: Wikipedia/Wikidata, reputable media, GitHub, official docs.`,
              "Use one consistent name and description everywhere so models associate it with the category.",
            ],
        evidence,
      });
    }
  }

  // contradicted-facts
  const contradicted = ok.flatMap((r) => r.contradictedFacts.map((fact) => ({ fact, r })));
  if (contradicted.length) {
    const distinct = [...new Set(contradicted.map((x) => x.fact))];
    recs.push({
      id: "contradicted-facts", priority: "high", area: "accuracy",
      title: `AI engines contradict ${distinct.length} canonical fact${distinct.length > 1 ? "s" : ""} about ${s}`,
      why: "Users trust AI answers; misstated facts spread misinformation and erode credibility.",
      actions: [
        "State each fact explicitly on your official site and docs, in plain sentences that are easy to quote.",
        "Correct outdated third-party pages that repeat the wrong version and ask for updates where you cannot edit.",
        "Publish a concise, dated fact sheet or press kit and link to it from your main pages.",
      ],
      evidence: [
        `${contradicted.length} contradiction(s) across ${new Set(contradicted.map((x) => x.r.answer.engine)).size} engine(s)`,
        ...contradicted.slice(0, MAX_EXAMPLES).map(({ fact, r }) => `${label(r.answer.engine)} contradicted "${fact}" in: "${r.probe.query}"`),
      ],
    });
  }

  // suspect-claims
  const suspects = ok.flatMap((r) => r.suspectClaims.map((claim) => ({ claim, r })));
  if (suspects.length >= 2) {
    recs.push({
      id: "suspect-claims", priority: "medium", area: "accuracy",
      title: `AI engines make unverified or doubtful claims about ${s}`,
      why: "Unverifiable claims can turn into perceived facts if nothing authoritative contradicts them.",
      actions: [
        "Review each claim; publish clear, sourced statements that confirm or refute it.",
        "Add a public FAQ addressing the recurring claims.",
      ],
      evidence: [
        `${suspects.length} suspect claim(s) flagged by the judge`,
        ...suspects.slice(0, MAX_EXAMPLES).map(({ claim, r }) => `${label(r.answer.engine)}: "${claim}" (query: "${r.probe.query}")`),
      ],
    });
  }

  // negative-sentiment
  if (overall.negativeShare > 0.2) {
    const neg = ok.filter((r) => r.sentiment === "negative");
    recs.push({
      id: "negative-sentiment", priority: "high", area: "sentiment",
      title: `A large share of answers about ${s} are negative`,
      why: "Negative framing in AI answers directly lowers conversion from users who ask before choosing.",
      actions: [
        "Identify the recurring concerns in the negative answers and address them publicly with facts.",
        "Encourage credible, recent reviews and case studies that reflect the current state of the product.",
        "Respond to the risks AI engines cite with a transparent security, audit or trust page.",
      ],
      evidence: [
        `negativeShare = ${f3(overall.negativeShare)} among answers mentioning ${s}; threshold 0.20`,
        ...neg.slice(0, MAX_EXAMPLES).map((r) => `${label(r.answer.engine)} (${r.probe.intent}): "${r.excerpt.slice(0, 120)}"`),
      ],
    });
  }

  // own-citations
  const searchAnswers = ok.filter((r) => r.search);
  if (searchAnswers.length && overall.citationShare < 0.2) {
    const hasDomains = (req.domains ?? []).length > 0;
    recs.push({
      id: "own-citations", priority: hasDomains ? "high" : "medium", area: "citations",
      title: hasDomains ? `Search-enabled engines rarely cite ${s}'s own sites` : `No own domains were given, so citations of ${s}'s sites could not be measured`,
      why: "Citations are where search-based engines send users; if your pages are not cited, others tell your story.",
      actions: hasDomains
        ? [
            "Make key pages fast, crawlable and quotable: clear headings, direct answers, up-to-date dates.",
            "Add structured data (Organization, Product, FAQ) and keep a public sitemap.",
            `Create pages that answer the exact questions users ask about ${s} and ${c}.`,
          ]
        : ["Provide your official domains in the next audit to measure citation share.", "Make sure official pages answer the common questions directly."],
      evidence: [
        `citationShare = ${f3(overall.citationShare)} (${searchAnswers.filter((r) => r.ownDomainCited).length} of ${searchAnswers.length} search answers cite own domains); threshold 0.20`,
        ...(topCitedDomains.length ? [`Most cited instead: ${topCitedDomains.slice(0, 5).map((d) => `${d.domain} (${d.count})`).join(", ")}`] : []),
      ],
    });
  }

  // share-of-voice
  const subjectSov = shareOfVoice.find((x) => x.name === s);
  const ahead = shareOfVoice.filter((x) => x.name !== s && x.mentions > (subjectSov?.mentions ?? 0)).slice(0, 3);
  if (ahead.length) {
    recs.push({
      id: "share-of-voice", priority: "medium", area: "competition",
      title: `Competitors are mentioned more often than ${s}`,
      why: "AI engines present a short list; being mentioned less often than competitors means losing the user's consideration set.",
      actions: ahead.map((x) => `Publish an honest "${s} vs ${x.name}" comparison that states where ${s} is the better choice.`),
      evidence: [
        `${s}: ${subjectSov?.mentions ?? 0} mentions (share ${pct(subjectSov?.share ?? 0)})`,
        ...ahead.map((x) => `${x.name}: ${x.mentions} mentions (share ${pct(x.share)})`),
      ],
    });
  }

  // rank
  if (overall.avgRank !== null && overall.avgRank > 3) {
    recs.push({
      id: "rank", priority: "low", area: "visibility",
      title: `${s} appears low in AI-generated lists`,
      why: "Users mostly act on the first two or three items in a list.",
      actions: [
        `Make ${s}'s distinctive advantage explicit and repeated in authoritative sources so engines rank it higher.`,
        "Earn placements near the top of third-party rankings that engines cite.",
      ],
      evidence: [`avgRank = ${overall.avgRank.toFixed(2)} across ${ok.filter((r) => r.rank !== null).length} list answers; threshold 3`],
    });
  }

  // token-trust
  if (req.subjectType === "token") {
    const trust = ok.filter((r) => r.probe.intent === "trust");
    const bad = trust.filter((r) => !r.mentioned || r.sentiment === "negative");
    if (trust.length && bad.length / trust.length >= 0.3) {
      recs.push({
        id: "token-trust", priority: "high", area: "token",
        title: `Trust questions about ${s} get negative or evasive answers`,
        why: "Before buying a token users ask whether it is legitimate; a doubtful answer kills the purchase.",
        actions: [
          "Publish the official contract address(es) on the website, docs and verified socials, and keep them consistent.",
          "Make audits, team information and token distribution easy to find and quote.",
          "Get listed and verified on major trackers (CoinGecko, CoinMarketCap, block explorers).",
        ],
        evidence: [
          `${bad.length} of ${trust.length} trust answers (${pct(bad.length / trust.length)}) are negative or do not mention ${s}; threshold 30%`,
          ...bad.slice(0, 3).map((r) => `${label(r.answer.engine)}: "${r.probe.query}" → ${r.mentioned ? "negative" : "not mentioned"}`),
        ],
      });
    }
  }

  return recs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY_ORDER[a.r.priority] - PRIORITY_ORDER[b.r.priority] || a.i - b.i)
    .map(({ r }) => r);
}
