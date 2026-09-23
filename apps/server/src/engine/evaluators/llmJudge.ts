import type { EvaluationOutcome, EvaluatorOf } from "@aieval/shared";
import { chatCompletion, messageText } from "../openrouter";
import { requireSecret } from "../secrets";
import { render, toText, tryParseJson } from "../template";
import type { EvalDeps, EvalSubject } from "./types";

const SYSTEM = `You are a strict, impartial evaluator of AI system outputs.
Grade the OUTPUT against the RUBRIC. Use EXPECTED (if provided) as the reference answer.
Respond with ONLY a JSON object: {"score": <number between 0 and 1>, "reasoning": "<one or two sentences>"}`;

export async function runLlmJudge(e: EvaluatorOf<"llm_judge">, s: EvalSubject, deps: EvalDeps): Promise<EvaluationOutcome> {
  const base = { evaluatorId: e.id, name: e.name, type: e.type, required: e.required, weight: e.weight };
  try {
    const apiKey = requireSecret(deps.secrets, e.apiKeySecret);
    const rubric = render(e.rubric, { input: s.input, expected: s.expected, output: s.output });
    const parts = [
      `RUBRIC:\n${rubric}`,
      `INPUT:\n${toText(s.input)}`,
      s.expected !== null && s.expected !== undefined ? `EXPECTED:\n${toText(s.expected)}` : "",
      s.toolCalls.length ? `TOOL CALLS:\n${JSON.stringify(s.toolCalls.map((c) => ({ tool: c.alias, args: c.args, error: c.isError })))}` : "",
      `OUTPUT:\n${s.output}`,
    ].filter(Boolean);
    const res = await chatCompletion(
      apiKey,
      {
        model: e.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: parts.join("\n\n") },
        ],
      },
      { signal: deps.signal, fetch: deps.fetch },
    );
    const text = messageText(res.choices[0].message);
    const parsed = (tryParseJson(text) ?? tryParseJson(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))) as
      | { score?: number; reasoning?: string }
      | undefined;
    const score = Number(parsed?.score);
    if (!parsed || Number.isNaN(score)) {
      return { ...base, pass: false, score: null, needsReview: true, error: `Judge returned unparseable output: ${text.slice(0, 300)}` };
    }
    const clamped = Math.max(0, Math.min(1, score));
    return {
      ...base,
      pass: clamped >= e.threshold,
      score: clamped,
      needsReview: false,
      reasoning: parsed.reasoning ?? "",
      details: { model: res.model, usage: res.usage },
    };
  } catch (err) {
    return { ...base, pass: false, score: null, needsReview: true, error: (err as Error).message };
  }
}
