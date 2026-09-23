import { describe, expect, it } from "vitest";
import { defaultEvaluator, type Evaluator } from "@aieval/shared";
import { containsSubset, runAssertion } from "../evaluators/assertions";
import type { EvalSubject } from "../evaluators/types";

const subject = (over: Partial<EvalSubject> = {}): EvalSubject => ({
  input: { q: "capital of France?" },
  expected: { answer: "Paris" },
  output: "The capital of France is Paris.",
  outputJson: undefined,
  statusCode: 200,
  latencyMs: 120,
  costUsd: 0.002,
  toolCalls: [],
  ...over,
});

const ev = (type: Evaluator["type"], patch: Record<string, unknown> = {}) => ({ ...defaultEvaluator(type, "e1"), ...patch }) as Evaluator;

describe("assertions", () => {
  it("contains / not_contains / equals with templates", () => {
    expect(runAssertion(ev("contains"), subject()).pass).toBe(true);
    expect(runAssertion(ev("contains", { value: "berlin" }), subject()).pass).toBe(false);
    expect(runAssertion(ev("not_contains", { value: "berlin" }), subject()).pass).toBe(true);
    expect(runAssertion(ev("equals", { value: "{{expected.answer}}" }), subject({ output: " Paris " })).pass).toBe(true);
  });

  it("regex, json_schema and json_path", () => {
    expect(runAssertion(ev("regex", { pattern: "paris", flags: "i" }), subject()).pass).toBe(true);
    const json = subject({ output: '{"answer":"Paris","score":2}', outputJson: { answer: "Paris", score: 2 } });
    expect(runAssertion(ev("json_schema", { schema: { type: "object", required: ["answer"] } }), json).pass).toBe(true);
    expect(runAssertion(ev("json_schema", { schema: { type: "object", required: ["missing"] } }), json).pass).toBe(false);
    expect(runAssertion(ev("json_path", { path: "$.score", mode: "equals", value: "2" }), json).pass).toBe(true);
    expect(runAssertion(ev("json_path", { path: "$.answer", mode: "equals", value: "{{expected.answer}}" }), json).pass).toBe(true);
    expect(runAssertion(ev("json_path", { path: "$.nope" }), json).pass).toBe(false);
    expect(runAssertion(ev("json_schema"), subject()).reasoning).toMatch(/not valid JSON/);
  });

  it("status, latency and cost limits", () => {
    expect(runAssertion(ev("status_code", { codes: [200, 201] }), subject()).pass).toBe(true);
    expect(runAssertion(ev("status_code", { codes: [500] }), subject()).pass).toBe(false);
    expect(runAssertion(ev("max_latency", { ms: 100 }), subject()).pass).toBe(false);
    expect(runAssertion(ev("max_cost", { usd: 0.01 }), subject()).pass).toBe(true);
  });

  it("tool_called / tool_not_called with argument subsets", () => {
    const s = subject({
      toolCalls: [{ alias: "kb__search", server: "kb", tool: "search", args: { query: "refund policy", limit: 5 }, result: null, isError: false, latencyMs: 10 }],
    });
    expect(runAssertion(ev("tool_called", { tool: "search" }), s).pass).toBe(true);
    expect(runAssertion(ev("tool_called", { tool: "kb__search", argsContain: { query: "refund policy" } }), s).pass).toBe(true);
    expect(runAssertion(ev("tool_called", { tool: "kb__search", argsContain: { query: "other" } }), s).pass).toBe(false);
    expect(runAssertion(ev("tool_called", { tool: "search", minTimes: 2 }), s).pass).toBe(false);
    expect(runAssertion(ev("tool_not_called", { tool: "delete" }), s).pass).toBe(true);
  });

  it("reports an invalid regex as an evaluator error instead of throwing", () => {
    const o = runAssertion(ev("regex", { pattern: "(" }), subject());
    expect(o.pass).toBe(false);
    expect(o.error).toBeTruthy();
  });

  it("containsSubset handles nested objects and arrays", () => {
    expect(containsSubset({ a: { b: [1, 2, 3] }, c: 1 }, { a: { b: [2] } })).toBe(true);
    expect(containsSubset({ a: 1 }, { a: 2 })).toBe(false);
  });
});
