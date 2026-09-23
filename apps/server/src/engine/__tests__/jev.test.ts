import { describe, expect, it, vi } from "vitest";
import { suiteSettingsSchema, type Evaluator, type EvaluatorOf } from "@aieval/shared";
import { evaluateAll, verdict } from "../evaluators";
import { buildJevState, interpretJevAnswer, runJevEvaluators } from "../evaluators/jev";
import type { EvalDeps, EvalSubject } from "../evaluators/types";

const subject: EvalSubject = {
  input: { q: "I was charged twice" },
  expected: null,
  output: "You can view your transactions in the app.",
  latencyMs: 50,
  toolCalls: [{ alias: "billing__lookup", server: "billing", tool: "lookup", args: { id: 1 }, result: {}, isError: false, latencyMs: 5 }],
};

const noul: EvaluatorOf<"jev_noul"> = {
  id: "addressed",
  name: "Addresses request",
  type: "jev_noul",
  instructions: "Does the response address the request?",
  trueDescription: "",
  falseDescription: "",
  threshold: 0.5,
  invert: false,
  reviewBand: 0.1,
  weight: 1,
  required: true,
};
const score: EvaluatorOf<"jev_score"> = {
  id: "helpful",
  name: "Helpfulness",
  type: "jev_score",
  instructions: "Rate helpfulness",
  levels: ["bad", "ok", "good", "great", "perfect"],
  threshold: 0.6,
  reviewBelowConfidence: 0.5,
  weight: 2,
  required: true,
};
const choice: EvaluatorOf<"jev_choice"> = {
  id: "tone",
  name: "Tone",
  type: "jev_choice",
  instructions: "Tone?",
  options: { polite: "", rude: "" },
  passOptions: ["polite"],
  reviewBelowConfidence: 0.5,
  weight: 1,
  required: false,
};

const deps = (jev: EvalDeps["jev"]): EvalDeps => ({
  secrets: { TYPESAFE_API_KEY: "ts-key" },
  settings: suiteSettingsSchema.parse({}),
  jev,
  fetch: vi.fn() as unknown as typeof fetch,
});

describe("Jev evaluators", () => {
  it("maps noul / score / choice answers to pass, score and review flags", () => {
    expect(interpretJevAnswer(noul, { type: "noul", noul: 0.11 })).toMatchObject({ pass: false, score: 0.11, needsReview: false });
    expect(interpretJevAnswer(noul, { type: "noul", noul: 0.55 })).toMatchObject({ pass: true, needsReview: true });
    expect(interpretJevAnswer({ ...noul, invert: true }, { type: "noul", noul: 0.2 })).toMatchObject({ pass: true, score: 0.8 });
    expect(interpretJevAnswer(score, { type: "score", score: 3, confidence: 0.9, probabilities: {} })).toMatchObject({ pass: true, score: 0.75, needsReview: false });
    expect(interpretJevAnswer(score, { type: "score", score: 1.2, confidence: 0.3, probabilities: {} })).toMatchObject({ pass: false, needsReview: true });
    expect(interpretJevAnswer(choice, { type: "choice", choice: "polite", confidence: 0.8, probabilities: { polite: 0.8, rude: 0.2 } })).toMatchObject({ pass: true, score: 0.8 });
  });

  it("sends all Jev questions in ONE request with the right state and model", async () => {
    const jev = vi.fn().mockResolvedValue({
      model: "jev-latest",
      usage: { input_tokens: 10, output_tokens: 3 },
      answers: { q0: { type: "noul", noul: 0.9 }, q1: { type: "score", score: 4, confidence: 0.95, probabilities: {}, legend: {} } },
    });
    const out = await runJevEvaluators([noul, score], subject, deps(jev));
    expect(jev).toHaveBeenCalledTimes(1);
    const [key, req] = jev.mock.calls[0];
    expect(key).toBe("ts-key");
    expect(req.model).toBe("jev-latest");
    expect(req.questions.q0).toEqual({ type: "noul", instructions: noul.instructions });
    expect(req.questions.q1).toMatchObject({ type: "score", criteria: score.levels });
    expect(req.state).toEqual(buildJevState(subject));
    expect(req.state).toHaveProperty("tool_calls");
    expect(out.map((o) => o.pass)).toEqual([true, true]);
  });

  it("turns API failures into evaluator errors that fail the case", async () => {
    const jev = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429, body: { error: "slow down" } }));
    const out = await runJevEvaluators([noul], subject, deps(jev));
    expect(out[0]).toMatchObject({ pass: false, needsReview: true });
    expect(out[0].error).toMatch(/429/);
    expect(verdict(out).status).toBe("FAIL");
  });

  it("verdict ignores non-required failures and weights scores", async () => {
    const jev = vi.fn().mockResolvedValue({
      model: "jev-latest",
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        q0: { type: "noul", noul: 1 },
        q1: { type: "score", score: 4, confidence: 1, probabilities: {} },
        q2: { type: "choice", choice: "rude", confidence: 0.9, probabilities: { polite: 0, rude: 1 } },
      },
    });
    const outcomes = await evaluateAll([noul, score, choice] as Evaluator[], subject, deps(jev));
    const v = verdict(outcomes);
    expect(v.status).toBe("PASS"); // choice failed but is informational
    expect(v.score).toBeCloseTo((1 * 1 + 1 * 2 + 0 * 1) / 4);
  });

  it("a missing TypeSafe key yields a clear error", async () => {
    const d = deps(vi.fn());
    d.secrets = {};
    const out = await runJevEvaluators([noul], subject, d);
    expect(out[0].error).toMatch(/TYPESAFE_API_KEY/);
  });
});
