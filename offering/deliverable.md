A JSON string (`schemaVersion: "1.0"`) with a verifiable GEO (Generative Engine Optimization) audit of the subject across ChatGPT, Claude, Perplexity and Gemini.

**Contents**

- `scores.overall` — GEO score 0–100 plus visibility, organic (unbranded) visibility, average list rank, positive/negative sentiment share, factual accuracy and own-domain citation share. The formula is included in `method.scoring`.
- `scores.byEngine`, `scores.byIntent` — the same metrics per engine and per question type (discovery, direct, comparison, trust, action, custom).
- `shareOfVoice` — subject vs. competitors in unbranded discovery answers (top 12).
- `issues` — contradicted facts, suspect claims and negative answers, each with engine and query.
- `topCitedDomains` — domains the search-enabled engines cite (top 15).
- `recommendations` — prioritized actions; every item carries measured `evidence`.
- `evidence` — every question × engine answer: mention, rank, sentiment, excerpt (≤ 240 chars), citations.
- `summaryMarkdown` — human-readable summary.

**Verifiable invariants:** `evidence.length == method.probes` unless `evidenceTruncated` is set; `scores.overall.visibility` can be recomputed from `evidence`; mention, rank and citations are computed deterministically, an LLM judge is used only for sentiment, fact checks and competitor extraction.

Optional: `fullReportUrl` links to the full report when the inline JSON was truncated to fit the size limit.
