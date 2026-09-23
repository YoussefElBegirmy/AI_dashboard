import { JSONPath } from "jsonpath-plus";

/**
 * Minimal, safe templating: `{{ path.to.value }}` / `{{ list[0].x }}`.
 * No logic, no HTML escaping. Objects are JSON-stringified when interpolated into text.
 */

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const EXACT = /^\{\{\s*([^{}]+?)\s*\}\}$/;

export type TemplateContext = Record<string, unknown>;

export function lookup(ctx: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\[["']([^"']+)["']\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

export function render(template: string, ctx: TemplateContext): string {
  if (typeof template !== "string" || !template.includes("{{")) return template;
  return template.replace(TOKEN, (_m, path: string) => stringify(lookup(ctx, path)));
}

/**
 * Render every string leaf of a JSON value. A leaf that is exactly `{{path}}`
 * is replaced by the raw value so objects/numbers/booleans keep their type.
 */
export function renderDeep(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === "string") {
    const exact = value.match(EXACT);
    if (exact) {
      const v = lookup(ctx, exact[1]);
      return v === undefined ? "" : v;
    }
    return render(value, ctx);
  }
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [render(k, ctx), renderDeep(v, ctx)]));
  }
  return value;
}

export function renderRecord(rec: Record<string, string>, ctx: TemplateContext): Record<string, string> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, render(v, ctx)]));
}

/** Returns the first JSONPath match (or undefined). An empty path returns the value itself. */
export function extractPath(json: unknown, path: string): unknown {
  if (!path || path === "$") return json;
  if (json === null || json === undefined || typeof json !== "object") return undefined;
  const res = JSONPath({ path, json: json as object, wrap: true }) as unknown[];
  return res.length ? res[0] : undefined;
}

export function tryParseJson(text: string): unknown {
  const t = text.trim();
  if (!t || !"{[".includes(t[0])) {
    // allow ```json fences from LLMs
    const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (!fenced) return undefined;
    return tryParseJson(fenced[1]);
  }
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export function toText(value: unknown): string {
  return stringify(value);
}
