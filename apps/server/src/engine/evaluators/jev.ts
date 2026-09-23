import { TypeSafeClient, type Question, type Questions, type SystemOneRequest } from "@typesafe-ai/sdk";
import type { EvaluationOutcome, EvaluatorOf } from "@aieval/shared";
import { requireSecret } from "../secrets";
import { render } from "../template";
import type { EvalDeps, EvalSubject } from "./types";

export type JevEvaluator = EvaluatorOf<"jev_noul" | "jev_choice" | "jev_score">;

const clients = new Map<string, TypeSafeClient>();

/** Default Jev transport: the official SDK (retries 408/429/5xx with backoff). */
export async function callJev(apiKey: string, req: SystemOneRequest<Questions>, signal?: AbortSignal) {
  let client = clients.get(apiKey);
  if (!client) {
    client = new TypeSafeClient({ apiKey, timeout: 30_000, logLevel: "error" });
    clients.set(apiKey, client);
  }
  return client.systemOne(req, { signal });
}

/** The state Jev judges: what went in, what was expected, what came out, and which tools were used. */
export function buildJevState(s: EvalSubject): Record<string, unknown> {
  const state: Record<string, unknown> = { input: s.input as never, output: s.output };
  if (s.expected !== null && s.expected !== undefined) state.expected = s.expected as never;
  if (s.toolCalls.length) {
    state.tool_calls = s.toolCalls.map((c) => ({ tool: c.alias, arguments: c.args, error: c.isError }));
  }
  return JSON.parse(JSON.stringify(state));
}

export function toJevQuestion(e: JevEvaluator, s: EvalSubject): Question {
  const instructions = render(e.instructions, { input: s.input, expected: s.expected, output: s.output });
  switch (e.type) {
    case "jev_noul":
      return {
        type: "noul",
        instructions,
        ...((e.trueDescription || e.falseDescription) && {
          criteria: { ...(e.trueDescription && { true: e.trueDescription }), ...(e.falseDescription && { false: e.falseDescription }) },
        }),
      };
    case "jev_choice":
      return { type: "choice", instructions, criteria: Object.fromEntries(Object.entries(e.options).map(([k, v]) => [k, v || null])) };
    case "jev_score":
      return { type: "score", instructions, criteria: e.levels as unknown as readonly [string, string, ...string[]] };
  }
}

/** Maps a Jev answer onto pass / score / needsReview. Exported for tests. */
export function interpretJevAnswer(e: JevEvaluator, answer: unknown): Omit<EvaluationOutcome, "evaluatorId" | "name" | "type" | "required" | "weight"> {
  const a = answer as Record<string, unknown>;
  switch (e.type) {
    case "jev_noul": {
      const p = Number(a.noul);
      const yes = p;
      const pass = e.invert ? 1 - p >= e.threshold : p >= e.threshold;
      const needsReview = Math.abs(p - 0.5) < e.reviewBand;
      return {
        pass,
        score: e.invert ? 1 - yes : yes,
        needsReview,
        reasoning: `P(yes) = ${p.toFixed(3)}${e.invert ? " (inverted)" : ""}; threshold ${e.threshold}`,
        details: a,
      };
    }
    case "jev_choice": {
      const choice = String(a.choice);
      const confidence = Number(a.confidence);
      const probs = (a.probabilities ?? {}) as Record<string, number>;
      const passMass = e.passOptions.reduce((sum, o) => sum + (probs[o] ?? 0), 0);
      return {
        pass: e.passOptions.includes(choice),
        score: passMass,
        needsReview: confidence < e.reviewBelowConfidence,
        reasoning: `Chose "${choice}" (confidence ${confidence.toFixed(2)})`,
        details: a,
      };
    }
    case "jev_score": {
      const raw = Number(a.score);
      const max = e.levels.length - 1;
      const normalised = max > 0 ? raw / max : 0;
      const confidence = Number(a.confidence);
      const nearest = e.levels[Math.round(raw)] ?? "";
      return {
        pass: normalised >= e.threshold,
        score: normalised,
        needsReview: confidence < e.reviewBelowConfidence,
        reasoning: `Score ${raw.toFixed(2)} / ${max} ≈ "${nearest}" (confidence ${confidence.toFixed(2)})`,
        details: a,
      };
    }
  }
}

/** All Jev evaluators for one result go out in a single System One request. */
export async function runJevEvaluators(evaluators: JevEvaluator[], s: EvalSubject, deps: EvalDeps): Promise<EvaluationOutcome[]> {
  if (!evaluators.length) return [];
  const base = (e: JevEvaluator) => ({ evaluatorId: e.id, name: e.name, type: e.type, required: e.required, weight: e.weight });
  const questions: Questions = {};
  evaluators.forEach((e, i) => (questions[`q${i}`] = toJevQuestion(e, s)));

  try {
    const apiKey = requireSecret(deps.secrets, deps.settings.jevApiKeySecret);
    const res = await deps.jev(apiKey, { model: deps.settings.jevModel, state: buildJevState(s) as never, questions }, deps.signal);
    return evaluators.map((e, i) => {
      const answer = res.answers[`q${i}`];
      if (!answer) return { ...base(e), pass: false, score: null, needsReview: true, error: "Jev returned no answer" };
      return { ...base(e), ...interpretJevAnswer(e, answer), details: { answer, model: res.model, usage: res.usage } };
    });
  } catch (err) {
    const e = err as Error & { status?: number; body?: unknown };
    const msg = e.status ? `Jev HTTP ${e.status}: ${typeof e.body === "string" ? e.body : JSON.stringify(e.body ?? e.message)}` : e.message;
    return evaluators.map((ev) => ({ ...base(ev), pass: false, score: null, needsReview: true, error: msg }));
  }
}
