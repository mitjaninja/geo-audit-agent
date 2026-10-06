import { readFileSync } from "node:fs";
import { Ajv, type ErrorObject } from "ajv";
import type { Requirements } from "./types.js";

// Валидация requirements по опубликованной в ACP схеме — той же, по которой
// клиентский SDK проверяет запрос до создания сделки.

const schemaUrl = new URL("../offering/requirements.schema.json", import.meta.url);
export const requirementsSchema: object = JSON.parse(readFileSync(schemaUrl, "utf8"));

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
const check = ajv.compile<Requirements>(requirementsSchema);

export type ValidationResult = { ok: true; value: Requirements } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "invalid requirement";
  return errors
    .map((e) => {
      const path = e.instancePath || "/";
      const extra = e.keyword === "additionalProperties" ? ` (${String(e.params["additionalProperty"])})`
        : e.keyword === "enum" ? ` (${(e.params["allowedValues"] as unknown[]).join(", ")})`
        : "";
      return `${path} ${e.message ?? e.keyword}${extra}`;
    })
    .join("; ");
}

/**
 * Принимает объект или JSON-строку; снимает обёртки {requirement} / {serviceRequirement}
 * (в том числе если внутри обёртки снова JSON-строка), применяет default-значения.
 */
export function validateRequirements(input: unknown): ValidationResult {
  let data: unknown = input;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return { ok: false, error: "/ requirement is not valid JSON" };
      }
    }
    if (isObject(data) && ("requirement" in data || "serviceRequirement" in data) && Object.keys(data).length === 1) {
      data = data["requirement"] ?? data["serviceRequirement"];
      continue;
    }
    break;
  }
  if (!isObject(data)) return { ok: false, error: "/ requirement must be a JSON object" };

  // Копия, чтобы useDefaults не мутировал вход вызывающего.
  const value = structuredClone(data);
  if (!check(value)) return { ok: false, error: formatErrors(check.errors) };
  return { ok: true, value };
}
