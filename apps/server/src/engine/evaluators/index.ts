import { isJevEvaluator, type EvaluationOutcome, type Evaluator, type ResultStatus } from "@aieval/shared";
import { runAssertion } from "./assertions";
import { runJevEvaluators } from "./jev";
import { runLlmJudge } from "./llmJudge";
import type { EvalDeps, EvalSubject } from "./types";

export type { EvalDeps, EvalSubject } from "./types";

export async function evaluateAll(evaluators: Evaluator[], subject: EvalSubject, deps: EvalDeps): Promise<EvaluationOutcome[]> {
  const jev = evaluators.filter(isJevEvaluator);
  const judges = evaluators.filter((e) => e.type === "llm_judge");
  const [jevOutcomes, judgeOutcomes] = await Promise.all([
    runJevEvaluators(jev, subject, deps),
    Promise.all(judges.map((e) => runLlmJudge(e as Extract<Evaluator, { type: "llm_judge" }>, subject, deps))),
  ]);
  const byId = new Map<string, EvaluationOutcome>();
  for (const o of [...jevOutcomes, ...judgeOutcomes]) byId.set(o.evaluatorId, o);
  // keep the configured order
  return evaluators.map((e) => byId.get(e.id) ?? runAssertion(e, subject));
}

/** Combines evaluator outcomes into the case verdict. */
export function verdict(outcomes: EvaluationOutcome[]): { status: Extract<ResultStatus, "PASS" | "FAIL">; score: number | null; needsReview: boolean } {
  const failed = outcomes.some((o) => o.required && o.pass !== true);
  const scored = outcomes.filter((o) => o.score !== null && o.weight > 0);
  const totalWeight = scored.reduce((s, o) => s + o.weight, 0);
  const score = totalWeight ? scored.reduce((s, o) => s + (o.score ?? 0) * o.weight, 0) / totalWeight : null;
  return { status: failed ? "FAIL" : "PASS", score, needsReview: outcomes.some((o) => o.needsReview) };
}
