import type { WorkflowState } from "./types";

// ---------------------------------------------------------------------------
// Template / Expression Engine
// ---------------------------------------------------------------------------

export const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
export const MAX_TEMPLATE_DEPTH = 10;

export function resolveTemplate(template: string, state: WorkflowState): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const trimmed = expr.trim();

    const pipeIdx = trimmed.indexOf("|");
    const path = pipeIdx > -1 ? trimmed.slice(0, pipeIdx).trim() : trimmed;
    const filter = pipeIdx > -1 ? trimmed.slice(pipeIdx + 1).trim() : null;

    const parts = path.split(".");
    if (parts.length > MAX_TEMPLATE_DEPTH) return "";
    let current: unknown = state;
    for (const part of parts) {
      if (current === null || current === undefined) return "";
      if (BLOCKED_KEYS.has(part)) return "";
      if (typeof current !== "object" || Array.isArray(current)) return "";
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) return "";

    let result = typeof current === "object" ? JSON.stringify(current) : String(current);

    if (filter) {
      const filterName = filter.split(":")[0].trim();
      const filterArg = filter.includes(":") ? filter.split(":")[1].trim() : null;
      switch (filterName) {
        case "upper": result = result.toUpperCase(); break;
        case "lower": result = result.toLowerCase(); break;
        case "trim": result = result.trim(); break;
        case "length": result = String(typeof current === "string" ? current.length : Array.isArray(current) ? current.length : 0); break;
        case "number": result = String(Number(result) || 0); break;
        case "round": { const digits = parseInt(filterArg || "0"); result = String(Number(Number(result).toFixed(digits))); break; }
        case "json": result = typeof current === "object" ? JSON.stringify(current) : result; break;
      }
    }

    return result;
  });
}

export function evaluateCondition(expr: string, state: WorkflowState): boolean {
  const resolved = resolveTemplate(expr, state);

  const containsMatch = resolved.match(/^(.+?)\s+contains\s+"([^"]*)"$/i);
  if (containsMatch) return containsMatch[1].includes(containsMatch[2]);

  const notContainsMatch = resolved.match(/^(.+?)\s+not_contains\s+"([^"]*)"$/i);
  if (notContainsMatch) return !notContainsMatch[1].includes(notContainsMatch[2]);

  const equalsMatch = resolved.match(/^(.+?)\s+equals\s+"([^"]*)"$/i);
  if (equalsMatch) return equalsMatch[1].trim() === equalsMatch[2];

  const notEqualsMatch = resolved.match(/^(.+?)\s+not_equals\s+"([^"]*)"$/i);
  if (notEqualsMatch) return notEqualsMatch[1].trim() !== notEqualsMatch[2];

  const gtMatch = resolved.match(/^(.+?)\s+greater_than\s+(-?\d+(?:\.\d+)?)$/i);
  if (gtMatch) return Number(gtMatch[1]) > Number(gtMatch[2]);

  const ltMatch = resolved.match(/^(.+?)\s+less_than\s+(-?\d+(?:\.\d+)?)$/i);
  if (ltMatch) return Number(ltMatch[1]) < Number(ltMatch[2]);

  const gteMatch = resolved.match(/^(.+?)\s+gte\s+(-?\d+(?:\.\d+)?)$/i);
  if (gteMatch) return Number(gteMatch[1]) >= Number(gteMatch[2]);

  const lteMatch = resolved.match(/^(.+?)\s+lte\s+(-?\d+(?:\.\d+)?)$/i);
  if (lteMatch) return Number(lteMatch[1]) <= Number(lteMatch[2]);

  const isEmptyMatch = resolved.match(/^(.*?)\s+is_empty$/i);
  if (isEmptyMatch) { const v = isEmptyMatch[1].trim(); return v === "" || v === "null" || v === "undefined" || v === "[]" || v === "{}"; }

  const isNotEmptyMatch = resolved.match(/^(.*?)\s+is_not_empty$/i);
  if (isNotEmptyMatch) { const v = isNotEmptyMatch[1].trim(); return v !== "" && v !== "null" && v !== "undefined" && v !== "[]" && v !== "{}"; }

  return resolved.toLowerCase() === "true" || resolved === "1";
}

export function normalizeKey(name: string): string {
  return name.replace(/\s+/g, "_").toLowerCase();
}
