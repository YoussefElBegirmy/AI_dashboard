import { Ajv } from "ajv";
import type { EvaluationOutcome, Evaluator, EvaluatorOf } from "@aieval/shared";
import { extractPath, render, toText, tryParseJson } from "../template";
import type { EvalSubject } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** True when every key/value in `subset` appears (recursively) in `obj`. */
export function containsSubset(obj: unknown, subset: unknown): boolean {
  if (subset === null || typeof subset !== "object") return deepEqual(obj, subset);
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(subset)) {
    return Array.isArray(obj) && subset.every((s) => obj.some((o) => containsSubset(o, s)));
  }
  return Object.entries(subset).every(([k, v]) => containsSubset((obj as Record<string, unknown>)[k], v));
}

function norm(s: string, ci: boolean) {
  return ci ? s.toLowerCase() : s;
}

function ctxOf(s: EvalSubject) {
  return { input: s.input, expected: s.expected, output: s.output, outputJson: s.outputJson };
}

function matchesTool(call: { alias: string; tool: string }, name: string) {
  return call.alias === name || call.tool === name;
}

type Verdict = { pass: boolean; reasoning: string; details?: unknown };

function check(e: Evaluator, s: EvalSubject): Verdict {
  const ctx = ctxOf(s);
  switch (e.type) {
    case "equals": {
      const expected = render(e.value, ctx);
      const a = e.trim ? s.output.trim() : s.output;
      const b = e.trim ? expected.trim() : expected;
      const pass = norm(a, e.caseInsensitive) === norm(b, e.caseInsensitive);
      return { pass, reasoning: pass ? "Output equals expected value" : `Expected "${b.slice(0, 200)}"` };
    }
    case "contains":
    case "not_contains": {
      const needle = render(e.value, ctx);
      const found = norm(s.output, e.caseInsensitive).includes(norm(needle, e.caseInsensitive));
      const pass = e.type === "contains" ? found : !found;
      return { pass, reasoning: `"${needle.slice(0, 200)}" ${found ? "found" : "not found"} in output` };
    }
    case "regex": {
      const re = new RegExp(render(e.pattern, ctx), e.flags);
      const m = s.output.match(re);
      return { pass: Boolean(m), reasoning: m ? `Matched "${m[0].slice(0, 200)}"` : `No match for /${e.pattern}/${e.flags}` };
    }
    case "json_schema": {
      const data = s.outputJson ?? tryParseJson(s.output);
      if (data === undefined) return { pass: false, reasoning: "Output is not valid JSON" };
      const validate = ajv.compile(e.schema);
      const pass = validate(data) as boolean;
      return { pass, reasoning: pass ? "Output matches schema" : ajv.errorsText(validate.errors), details: validate.errors ?? undefined };
    }
    case "json_path": {
      const data = s.outputJson ?? tryParseJson(s.output);
      if (data === undefined) return { pass: false, reasoning: "Output is not valid JSON" };
      const actual = extractPath(data, e.path);
      if (e.mode === "exists") return { pass: actual !== undefined, reasoning: actual !== undefined ? `${e.path} exists` : `${e.path} not found` };
      const rendered = render(e.value, ctx);
      if (e.mode === "equals") {
        const expected = tryParseJson(rendered) ?? (rendered === "true" ? true : rendered === "false" ? false : rendered !== "" && !Number.isNaN(Number(rendered)) ? Number(rendered) : rendered);
        const pass = deepEqual(actual, expected) || toText(actual) === rendered;
        return { pass, reasoning: `${e.path} = ${toText(actual).slice(0, 200)}`, details: { actual, expected } };
      }
      const pass = toText(actual).includes(rendered);
      return { pass, reasoning: `${e.path} = ${toText(actual).slice(0, 200)}` };
    }
    case "status_code": {
      if (s.statusCode === undefined) return { pass: false, reasoning: "Target did not return an HTTP status" };
      const pass = e.codes.includes(s.statusCode);
      return { pass, reasoning: `Status ${s.statusCode}` };
    }
    case "max_latency": {
      const pass = s.latencyMs <= e.ms;
      return { pass, reasoning: `${s.latencyMs}ms (limit ${e.ms}ms)` };
    }
    case "max_cost": {
      const cost = s.costUsd ?? 0;
      const pass = cost <= e.usd;
      return { pass, reasoning: `$${cost.toFixed(6)} (limit $${e.usd})` };
    }
    case "tool_called": {
      const calls = s.toolCalls.filter((c) => matchesTool(c, e.tool));
      const matching = Object.keys(e.argsContain).length ? calls.filter((c) => containsSubset(c.args, e.argsContain)) : calls;
      const pass = matching.length >= e.minTimes;
      return {
        pass,
        reasoning: `${e.tool} called ${calls.length}× (${matching.length} with matching args, need ≥${e.minTimes})`,
        details: { calls: s.toolCalls.map((c) => c.alias) },
      };
    }
    case "tool_not_called": {
      const n = s.toolCalls.filter((c) => matchesTool(c, e.tool)).length;
      return { pass: n === 0, reasoning: n ? `${e.tool} was called ${n}×` : `${e.tool} was not called` };
    }
    default:
      throw new Error(`Not an assertion: ${e.type}`);
  }
}

export function runAssertion(e: Evaluator, s: EvalSubject): EvaluationOutcome {
  const base = { evaluatorId: e.id, name: e.name, type: e.type, required: e.required, weight: e.weight, needsReview: false };
  try {
    const v = check(e, s);
    return { ...base, pass: v.pass, score: v.pass ? 1 : 0, reasoning: v.reasoning, details: v.details };
  } catch (err) {
    return { ...base, pass: false, score: 0, error: (err as Error).message };
  }
}

export type AssertionEvaluator = Exclude<Evaluator, EvaluatorOf<"jev_noul" | "jev_choice" | "jev_score" | "llm_judge">>;
