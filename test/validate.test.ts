import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequirements } from "../src/validate.js";
import { loadConfig, enabledEngines, tierByOfferingName } from "../src/config.js";

const base = { subject: "Virtuals Protocol", subjectType: "protocol", category: "AI agent launchpads" };

test("validate: валидный запрос проходит, languages по умолчанию [\"en\"]", () => {
  const r = validateRequirements(base);
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.deepEqual(r.value.languages, ["en"]);
});

test("validate: вход не мутируется default-значениями", () => {
  const input = { ...base };
  validateRequirements(input);
  assert.equal("languages" in input, false);
});

test("validate: отказ без обязательных полей", () => {
  for (const field of ["subject", "subjectType", "category"] as const) {
    const { [field]: _omit, ...rest } = base;
    const r = validateRequirements(rest);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(`must have required property '${field}'`));
  }
});

test("validate: все ошибки одной строкой через «; »", () => {
  const r = validateRequirements({});
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.split("; ").length, 3);
    assert.doesNotMatch(r.error, /\n/);
  }
});

test("validate: отказ на не-JSON", () => {
  const r = validateRequirements("{not json");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not valid JSON/);
  assert.equal(validateRequirements(42).ok, false);
  assert.equal(validateRequirements(null).ok, false);
  assert.equal(validateRequirements([base]).ok, false);
});

test("validate: отказ на неверный enum", () => {
  const r1 = validateRequirements({ ...base, subjectType: "company" });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.error, /\/subjectType must be equal to one of the allowed values/);
  const r2 = validateRequirements({ ...base, languages: ["de"] });
  assert.equal(r2.ok, false);
});

test("validate: отказ на лишние поля и нарушение длины", () => {
  assert.equal(validateRequirements({ ...base, tier: "full" }).ok, false);
  assert.equal(validateRequirements({ ...base, subject: "X" }).ok, false);
  assert.equal(validateRequirements({ ...base, competitors: ["a", "b", "c", "d", "e", "f", "g"] }).ok, false);
});

test("validate: обёртки requirement / serviceRequirement и JSON-строки", () => {
  for (const wrapped of [
    { requirement: base },
    { serviceRequirement: base },
    JSON.stringify({ requirement: base }),
    { requirement: JSON.stringify(base) },
  ]) {
    const r = validateRequirements(wrapped);
    assert.ok(r.ok, !r.ok ? r.error : "");
    assert.equal(r.value.subject, "Virtuals Protocol");
    assert.deepEqual(r.value.languages, ["en"]);
  }
});

test("config: дефолты, движки по ключам, тариф по имени оффера", () => {
  const cfg = loadConfig({});
  assert.equal(cfg.offerings.quick.price, 3);
  assert.equal(cfg.offerings.full.price, 15);
  assert.equal(cfg.judge.model, "claude-sonnet-5-5");
  assert.deepEqual(enabledEngines(cfg), []);
  assert.deepEqual(enabledEngines(loadConfig({ PERPLEXITY_API_KEY: "x" })), ["perplexity"]);
  assert.equal(enabledEngines(loadConfig({ MOCK_ENGINES: "1" })).length, 4);
  assert.equal(tierByOfferingName(cfg, "GEO Audit Full"), "full");
  assert.equal(tierByOfferingName(cfg, "something else"), "quick");
  assert.throws(() => loadConfig({ CONCURRENCY: "abc" }));
});
