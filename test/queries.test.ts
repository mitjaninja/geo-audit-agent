import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildProbes, detectLang, FULL_PER_LANG, QUICK_PER_LANG } from "../src/queries.js";
import { validateRequirements } from "../src/validate.js";
import type { Requirements } from "../src/types.js";

const load = (name: string): Requirements => {
  const r = validateRequirements(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"));
  assert.ok(r.ok, !r.ok ? `${name}: ${r.error}` : "");
  return r.value;
};
const withoutCustom = (req: Requirements): Requirements => ({ ...req, customQueries: [] });

const token = load("token.json");
const brand = load("brand.json");

test("queries: примеры проходят валидацию", () => {
  assert.equal(token.subjectType, "token");
  assert.equal(brand.subjectType, "brand");
});

test("queries: Quick — 8–12 вопросов на 2 языка, есть discovery", () => {
  for (const req of [token, brand]) {
    const probes = buildProbes(withoutCustom(req), "quick");
    assert.ok(probes.length >= 8 && probes.length <= 12, `${req.subject}: ${probes.length}`);
    for (const lang of ["en", "ru"] as const) {
      const ofLang = probes.filter((p) => p.lang === lang);
      assert.ok(ofLang.length <= QUICK_PER_LANG);
      assert.equal(ofLang.filter((p) => p.intent === "discovery").length, 2);
      for (const intent of ["direct", "trust", "comparison", "action"]) {
        assert.ok(ofLang.some((p) => p.intent === intent), `${req.subject} ${lang}: нет ${intent}`);
      }
    }
  }
});

test("queries: Full больше Quick и не больше 16 на язык", () => {
  for (const req of [token, brand]) {
    const quick = buildProbes(req, "quick");
    const full = buildProbes(req, "full");
    assert.ok(full.length > quick.length);
    for (const lang of ["en", "ru"] as const) {
      const ofLang = full.filter((p) => p.lang === lang && p.intent !== "custom");
      assert.ok(ofLang.length <= FULL_PER_LANG);
    }
  }
});

test("queries: токен получает вопрос с контрактом, в том числе в Quick", () => {
  for (const tier of ["quick", "full"] as const) {
    const probes = buildProbes(token, tier);
    const withCa = probes.filter((p) => p.query.includes(token.contractAddress!));
    assert.equal(withCa.length, 2, tier); // en + ru
    assert.ok(withCa.every((p) => p.intent === "trust"));
  }
  const noCa = buildProbes({ ...token, contractAddress: undefined }, "full");
  assert.ok(noCa.every((p) => !p.query.includes("contract") && !p.query.includes("контракт")));
});

test("queries: бренд не получает токеномику и покупку токена", () => {
  const probes = buildProbes(brand, "full");
  assert.ok(probes.every((p) => !/tokenomics|токеномик|buy|купить/i.test(p.query)), probes.map((p) => p.query).join("\n"));
  assert.ok(buildProbes(token, "full").some((p) => /tokenomics/.test(p.query)));
});

test("queries: person получает свои шаблоны", () => {
  const person: Requirements = { subject: "Vitalik Buterin", subjectType: "person", category: "crypto founders", languages: ["en"] };
  const probes = buildProbes(person, "full");
  assert.ok(probes.some((p) => p.query === "Who is Vitalik Buterin and what are they known for?"));
  assert.ok(probes.every((p) => !p.query.startsWith("What is ") && !/legit or a scam/.test(p.query)));
});

test("queries: без конкурентов шаблоны с {comp} пропускаются, плейсхолдеров не остаётся", () => {
  const probes = buildProbes({ ...brand, competitors: undefined }, "full");
  assert.ok(probes.every((p) => !/\{(s|c|comp|ca)\}/.test(p.query)));
  assert.ok(probes.every((p) => !/ vs |или .* — что лучше/.test(p.query)));
  // comparison всё равно есть — через альтернативы.
  assert.ok(probes.filter((p) => p.intent === "comparison").length >= 2);
});

test("queries: discovery не называет объект, остальные называют", () => {
  for (const p of buildProbes(token, "full")) {
    if (p.intent === "discovery") {
      assert.equal(p.namesSubject, false);
      assert.ok(!p.query.includes(token.subject));
    } else if (p.intent !== "custom") {
      assert.equal(p.namesSubject, true, p.query);
      assert.ok(p.query.includes(token.subject), p.query);
    }
  }
});

test("queries: customQueries в любом тарифе, язык по кириллице", () => {
  for (const tier of ["quick", "full"] as const) {
    const custom = buildProbes(brand, tier).filter((p) => p.intent === "custom");
    assert.equal(custom.length, 1);
    assert.equal(custom[0]!.lang, "ru");
    assert.equal(custom[0]!.namesSubject, false);
  }
  const en = buildProbes({ ...brand, languages: ["ru"], customQueries: ["Is Notion good for startups?"] }, "quick");
  const c = en.find((p) => p.intent === "custom")!;
  assert.equal(c.lang, "en");
  assert.equal(c.namesSubject, true);
  assert.equal(detectLang("Привет, Notion"), "ru");
  assert.equal(detectLang("Hello"), "en");
});

test("queries: id уникальны, результат детерминирован, дубли убираются", () => {
  const a = buildProbes(token, "full");
  assert.deepEqual(a, buildProbes(token, "full"));
  assert.equal(new Set(a.map((p) => p.id)).size, a.length);
  const dup = buildProbes({ ...brand, customQueries: ["What is Notion?"] }, "full");
  assert.equal(dup.filter((p) => p.query === "What is Notion?").length, 1);
});

test("queries: один язык — только его вопросы", () => {
  const probes = buildProbes({ ...withoutCustom(brand), languages: ["en"] }, "quick");
  assert.equal(probes.length, QUICK_PER_LANG);
  assert.ok(probes.every((p) => p.lang === "en"));
});
