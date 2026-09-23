import { z } from "zod";
import { evaluatorListSchema } from "./evaluators";

export const suiteSettingsSchema = z.object({
  /** TypeSafe model used by Jev evaluators. */
  jevModel: z.string().default("jev-latest"),
  /** Name of the project secret holding the TypeSafe key. */
  jevApiKeySecret: z.string().default("TYPESAFE_API_KEY"),
  /** Parallel cases per run. */
  concurrency: z.number().int().min(1).max(32).default(4),
});
export type SuiteSettings = z.infer<typeof suiteSettingsSchema>;

export const suiteInputSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(4000).default(""),
  evaluators: evaluatorListSchema.default([]),
  settings: suiteSettingsSchema.default({ jevModel: "jev-latest", jevApiKeySecret: "TYPESAFE_API_KEY", concurrency: 4 }),
  defaultTargetIds: z.array(z.string()).default([]),
});

export const testCaseInputSchema = z.object({
  name: z.string().min(1).max(200),
  input: z.unknown().default({}),
  expected: z.unknown().default(null),
  tags: z.array(z.string()).default([]),
  evaluators: evaluatorListSchema.default([]),
  useSuiteEvaluators: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type TestCaseInput = z.infer<typeof testCaseInputSchema>;

export const runInputSchema = z.object({
  targetIds: z.array(z.string()).min(1),
  name: z.string().max(200).optional(),
  /** Restrict to cases having any of these tags. */
  tags: z.array(z.string()).default([]),
  concurrency: z.number().int().min(1).max(32).optional(),
});
