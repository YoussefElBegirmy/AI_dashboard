/** Shapes produced by the execution engine and stored on RunResult. */

export interface ToolCallRecord {
  /** Name the model used (`server__tool`) or plain tool name for direct calls. */
  alias: string;
  server: string;
  tool: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  latencyMs: number;
}

export interface TraceStep {
  name: string;
  targetId?: string;
  targetName?: string;
  kind?: string;
  input: unknown;
  output: string;
  outputJson?: unknown;
  latencyMs: number;
  error?: string;
  costUsd?: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface RunnerOutput {
  /** Text used for evaluation. */
  output: string;
  /** Parsed JSON form of the output, if any. */
  outputJson?: unknown;
  /** Raw response (HTTP body, completion, MCP result...). */
  raw?: unknown;
  statusCode?: number;
  latencyMs: number;
  usage?: Usage;
  toolCalls?: ToolCallRecord[];
  trace?: TraceStep[];
}

export interface EvaluationOutcome {
  evaluatorId: string;
  name: string;
  type: string;
  pass: boolean | null;
  /** Normalised 0..1. */
  score: number | null;
  needsReview: boolean;
  required: boolean;
  weight: number;
  reasoning?: string;
  details?: unknown;
  error?: string;
}

export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ResultStatus = "PENDING" | "PASS" | "FAIL" | "ERROR";
export type Role = "OWNER" | "EDITOR" | "VIEWER";

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export type RunEvent =
  | { type: "status"; status: RunStatus; error?: string }
  | { type: "progress"; completed: number; total: number; passed: number; failed: number; errored: number }
  | { type: "result"; resultId: string; testCaseId: string | null; targetId: string | null; status: ResultStatus };
