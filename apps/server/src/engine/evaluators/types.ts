import type { SuiteSettings, ToolCallRecord } from "@aieval/shared";
import type { SystemOneRequest, SystemOneResult, Questions } from "@typesafe-ai/sdk";

/** Everything an evaluator may look at. */
export interface EvalSubject {
  input: unknown;
  expected: unknown;
  output: string;
  outputJson?: unknown;
  statusCode?: number;
  latencyMs: number;
  costUsd?: number;
  toolCalls: ToolCallRecord[];
}

export interface EvalDeps {
  secrets: Record<string, string>;
  settings: SuiteSettings;
  signal?: AbortSignal;
  /** Calls TypeSafe System One (injectable for tests). */
  jev: (apiKey: string, req: SystemOneRequest<Questions>, signal?: AbortSignal) => Promise<SystemOneResult<Questions>>;
  fetch: typeof fetch;
}
