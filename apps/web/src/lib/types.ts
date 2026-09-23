import type { Evaluator, McpAuthConfig, McpCapabilities, McpOAuthInfo, McpTransport, ResultStatus, Role, RunStatus, SuiteSettings, TargetKind, ToolCallRecord, TraceStep } from "@aieval/shared";

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  role: Role;
  _count?: { targets: number; suites: number; mcpServers: number; members: number };
}

export interface Target {
  id: string;
  projectId: string;
  name: string;
  description: string;
  kind: TargetKind;
  config: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  stats?: { results: number; passRate: number; avgLatencyMs: number | null; avgCostUsd: number | null; avgScore: number | null } | null;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  config: { url: string; headers: Record<string, string>; command: string; args: string[]; env: Record<string, string>; cwd: string; timeoutMs: number; auth: McpAuthConfig };
  status: "unknown" | "connected" | "error";
  lastError: string | null;
  lastCheckedAt: string | null;
  capabilities?: McpCapabilities | null;
  /** Present when the server uses OAuth 2.1. Tokens never reach the browser. */
  oauth?: McpOAuthInfo | null;
  counts?: { tools: number; resources: number; prompts: number } | null;
}

export interface TestCase {
  id: string;
  suiteId: string;
  name: string;
  input: unknown;
  expected: unknown;
  tags: string[];
  evaluators: Evaluator[];
  useSuiteEvaluators: boolean;
  enabled: boolean;
  position: number;
}

export interface RunSummary {
  id: string;
  suiteId: string;
  name: string;
  status: RunStatus;
  targetIds: string[];
  targetsSnapshot: Record<string, { name: string; kind: TargetKind; version: number }>;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  errored: number;
  avgScore: number | null;
  avgLatencyMs: number | null;
  totalCostUsd: number;
  error: string | null;
  tags: string[];
  concurrency: number;
  triggeredVia: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  suite?: { id: string; name: string };
  triggeredBy?: { name: string } | null;
}

export interface Suite {
  id: string;
  name: string;
  description: string;
  evaluators: Evaluator[];
  settings: SuiteSettings;
  defaultTargetIds: string[];
  updatedAt: string;
  cases?: TestCase[];
  _count?: { cases: number; runs: number };
  lastRun?: Pick<RunSummary, "id" | "status" | "passed" | "failed" | "errored" | "total" | "createdAt"> | null;
}

export interface EvaluationRow {
  id: string;
  evaluatorId: string;
  name: string;
  type: string;
  pass: boolean | null;
  score: number | null;
  needsReview: boolean;
  required: boolean;
  weight: number;
  reasoning: string | null;
  details: Record<string, unknown> | null;
  error: string | null;
}

export interface RunResult {
  id: string;
  runId: string;
  testCaseId: string | null;
  targetId: string | null;
  caseName: string;
  targetName: string;
  status: ResultStatus;
  humanStatus: "PASS" | "FAIL" | null;
  reviewNote: string | null;
  input: unknown;
  expected: unknown;
  output: string | null;
  outputJson: unknown;
  raw: unknown;
  statusCode: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  toolCalls: ToolCallRecord[] | null;
  trace: TraceStep[] | null;
  error: string | null;
  score: number | null;
  needsReview: boolean;
  evaluations: EvaluationRow[];
}

export interface RunDetail extends RunSummary {
  results: RunResult[];
}

export interface Metrics {
  window: { days: number; since: string; bucket: string };
  kpis: {
    results: number;
    runs: number;
    passRate: number | null;
    errorRate: number | null;
    avgScore: number | null;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    needsReview: number;
    reviewed: number;
  };
  trend: { bucket: string; targetId: string | null; targetName: string; results: number; passRate: number | null; avgScore: number | null; avgLatencyMs: number | null; costUsd: number | null }[];
  byTarget: {
    targetId: string | null;
    targetName: string;
    results: number;
    passed: number;
    failed: number;
    errored: number;
    avgScore: number | null;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    totalCostUsd: number;
    avgCostUsd: number | null;
    inputTokens: number;
    outputTokens: number;
    needsReview: number;
  }[];
  evaluators: { name: string; type: string; count: number; passRate: number | null; avgScore: number | null; avgConfidence: number | null; needsReview: number; errors: number }[];
  tags: { tag: string; results: number; passRate: number | null; avgScore: number | null }[];
  scoreHistogram: { bin: number; label: string; count: number }[];
  runs: { id: string; createdAt: string; name: string; suiteName: string; total: number; passRate: number | null; avgScore: number | null; avgLatencyMs: number | null; totalCostUsd: number | null }[];
  toolUsage: { tool: string; calls: number; errors: number; avgLatencyMs: number | null }[];
}

export interface TryResult {
  ok: boolean;
  error?: string;
  output?: string;
  outputJson?: unknown;
  raw?: unknown;
  statusCode?: number;
  latencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  toolCalls?: ToolCallRecord[];
  trace?: TraceStep[];
}
