import { z } from "zod";

/**
 * Evaluators grade a single target output. Three families:
 *  - Jev (TypeSafe System One): jev_noul / jev_choice / jev_score
 *  - LLM judge via OpenRouter: llm_judge
 *  - Deterministic assertions: everything else
 *
 * String values in assertions support `{{path}}` templates over
 * `{ input, expected, output, outputJson }`.
 */

const base = {
  id: z.string().min(1),
  name: z.string().min(1),
  /** Weight in the aggregate score. */
  weight: z.number().min(0).default(1),
  /** If false, a failure is reported but does not fail the case. */
  required: z.boolean().default(true),
};

export const jevNoulSchema = z.object({
  ...base,
  type: z.literal("jev_noul"),
  instructions: z.string().min(1),
  trueDescription: z.string().default(""),
  falseDescription: z.string().default(""),
  /** Pass when P(yes) >= threshold (or <= 1-threshold when invert). */
  threshold: z.number().min(0).max(1).default(0.5),
  /** Pass when the answer is "no" (e.g. "Does the answer contain a hallucination?"). */
  invert: z.boolean().default(false),
  /** Band around 0.5 that is flagged for human review. */
  reviewBand: z.number().min(0).max(0.5).default(0.1),
});

export const jevChoiceSchema = z.object({
  ...base,
  type: z.literal("jev_choice"),
  instructions: z.string().min(1),
  /** label -> description ("" = undescribed). */
  options: z.record(z.string(), z.string()),
  passOptions: z.array(z.string()).min(1),
  reviewBelowConfidence: z.number().min(0).max(1).default(0.5),
});

export const jevScoreSchema = z.object({
  ...base,
  type: z.literal("jev_score"),
  instructions: z.string().min(1),
  /** Ordered rubric, worst first. 2–10 levels. */
  levels: z.array(z.string()).min(2).max(10),
  /** Normalised score (score / (levels-1)) needed to pass. */
  threshold: z.number().min(0).max(1).default(0.6),
  reviewBelowConfidence: z.number().min(0).max(1).default(0.5),
});

export const llmJudgeSchema = z.object({
  ...base,
  type: z.literal("llm_judge"),
  model: z.string().default("openai/gpt-4o-mini"),
  rubric: z.string().min(1),
  /** Score is 0..1; pass when >= threshold. */
  threshold: z.number().min(0).max(1).default(0.7),
  apiKeySecret: z.string().default("OPENROUTER_API_KEY"),
});

const textCompare = { value: z.string(), caseInsensitive: z.boolean().default(false) };

export const equalsSchema = z.object({ ...base, type: z.literal("equals"), ...textCompare, trim: z.boolean().default(true) });
export const containsSchema = z.object({ ...base, type: z.literal("contains"), ...textCompare });
export const notContainsSchema = z.object({ ...base, type: z.literal("not_contains"), ...textCompare });
export const regexSchema = z.object({ ...base, type: z.literal("regex"), pattern: z.string().min(1), flags: z.string().default("") });
export const jsonSchemaSchema = z.object({ ...base, type: z.literal("json_schema"), schema: z.record(z.string(), z.unknown()) });
export const jsonPathSchema = z.object({
  ...base,
  type: z.literal("json_path"),
  path: z.string().min(1),
  /** "exists" | "equals" | "contains" */
  mode: z.enum(["exists", "equals", "contains"]).default("exists"),
  /** Compared against the value at `path` (JSON-parsed if possible, templated). */
  value: z.string().default(""),
});
export const statusCodeSchema = z.object({ ...base, type: z.literal("status_code"), codes: z.array(z.number().int()).min(1) });
export const maxLatencySchema = z.object({ ...base, type: z.literal("max_latency"), ms: z.number().positive() });
export const maxCostSchema = z.object({ ...base, type: z.literal("max_cost"), usd: z.number().nonnegative() });
export const toolCalledSchema = z.object({
  ...base,
  type: z.literal("tool_called"),
  /** Tool name (`tool` or `server__tool`). */
  tool: z.string().min(1),
  /** Optional JSON subset the call arguments must contain. */
  argsContain: z.record(z.string(), z.unknown()).default({}),
  minTimes: z.number().int().min(1).default(1),
});
export const toolNotCalledSchema = z.object({ ...base, type: z.literal("tool_not_called"), tool: z.string().min(1) });

export const evaluatorSchema = z.discriminatedUnion("type", [
  jevNoulSchema,
  jevChoiceSchema,
  jevScoreSchema,
  llmJudgeSchema,
  equalsSchema,
  containsSchema,
  notContainsSchema,
  regexSchema,
  jsonSchemaSchema,
  jsonPathSchema,
  statusCodeSchema,
  maxLatencySchema,
  maxCostSchema,
  toolCalledSchema,
  toolNotCalledSchema,
]);

export type Evaluator = z.infer<typeof evaluatorSchema>;
export type EvaluatorType = Evaluator["type"];
export type EvaluatorOf<T extends EvaluatorType> = Extract<Evaluator, { type: T }>;

export const evaluatorListSchema = z.array(evaluatorSchema);

export const JEV_TYPES = ["jev_noul", "jev_choice", "jev_score"] as const;
export const isJevEvaluator = (e: Evaluator): e is EvaluatorOf<"jev_noul" | "jev_choice" | "jev_score"> =>
  (JEV_TYPES as readonly string[]).includes(e.type);

export const EVALUATOR_LABELS: Record<EvaluatorType, { label: string; family: "Jev" | "LLM judge" | "Assertion" }> = {
  jev_noul: { label: "Jev · Yes/No", family: "Jev" },
  jev_choice: { label: "Jev · Choice", family: "Jev" },
  jev_score: { label: "Jev · Score", family: "Jev" },
  llm_judge: { label: "LLM judge", family: "LLM judge" },
  equals: { label: "Equals", family: "Assertion" },
  contains: { label: "Contains", family: "Assertion" },
  not_contains: { label: "Does not contain", family: "Assertion" },
  regex: { label: "Regex", family: "Assertion" },
  json_schema: { label: "JSON schema", family: "Assertion" },
  json_path: { label: "JSONPath", family: "Assertion" },
  status_code: { label: "HTTP status", family: "Assertion" },
  max_latency: { label: "Max latency", family: "Assertion" },
  max_cost: { label: "Max cost", family: "Assertion" },
  tool_called: { label: "Tool called", family: "Assertion" },
  tool_not_called: { label: "Tool not called", family: "Assertion" },
};

/** Starter configs used by the evaluator builder UI. */
export function defaultEvaluator(type: EvaluatorType, id: string): Evaluator {
  const common = { id, name: EVALUATOR_LABELS[type].label, weight: 1, required: true };
  switch (type) {
    case "jev_noul":
      return { ...common, type, instructions: "Does the output correctly and fully answer the input?", trueDescription: "", falseDescription: "", threshold: 0.5, invert: false, reviewBand: 0.1 };
    case "jev_choice":
      return { ...common, type, instructions: "How does the output compare to the expected answer?", options: { correct: "Matches the expected answer", partial: "Partially matches", wrong: "Wrong or missing" }, passOptions: ["correct"], reviewBelowConfidence: 0.5 };
    case "jev_score":
      return { ...common, type, instructions: "Rate the helpfulness and accuracy of the output.", levels: ["Useless or wrong", "Poor", "Acceptable", "Good", "Excellent"], threshold: 0.6, reviewBelowConfidence: 0.5 };
    case "llm_judge":
      return { ...common, type, model: "openai/gpt-4o-mini", rubric: "The output answers the user's question accurately and concisely.", threshold: 0.7, apiKeySecret: "OPENROUTER_API_KEY" };
    case "equals":
      return { ...common, type, value: "{{expected.answer}}", caseInsensitive: false, trim: true };
    case "contains":
      return { ...common, type, value: "{{expected.answer}}", caseInsensitive: true };
    case "not_contains":
      return { ...common, type, value: "", caseInsensitive: true };
    case "regex":
      return { ...common, type, pattern: ".+", flags: "" };
    case "json_schema":
      return { ...common, type, schema: { type: "object" } };
    case "json_path":
      return { ...common, type, path: "$.answer", mode: "exists", value: "" };
    case "status_code":
      return { ...common, type, codes: [200] };
    case "max_latency":
      return { ...common, type, ms: 5000 };
    case "max_cost":
      return { ...common, type, usd: 0.01 };
    case "tool_called":
      return { ...common, type, tool: "", argsContain: {}, minTimes: 1 };
    case "tool_not_called":
      return { ...common, type, tool: "" };
  }
}
