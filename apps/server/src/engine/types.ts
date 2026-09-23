import type { RunnerOutput, TargetKind } from "@aieval/shared";
import type { McpManager, McpServerLike } from "./mcp/manager";

export interface TargetLike {
  id: string;
  projectId: string;
  name: string;
  kind: TargetKind;
  config: unknown;
}

/** Injected so the engine can be unit-tested without a DB / network. */
export interface EngineDeps {
  mcp: Pick<McpManager, "callTool" | "capabilities">;
  loadTarget(projectId: string, id: string): Promise<TargetLike | null>;
  loadMcpServer(projectId: string, id: string): Promise<McpServerLike | null>;
  fetch: typeof fetch;
}

export interface RunContext {
  projectId: string;
  secrets: Record<string, string>;
  input: unknown;
  expected: unknown;
  signal?: AbortSignal;
  /** Workflow nesting depth. */
  depth: number;
  deps: EngineDeps;
}

/** Error that still carries whatever the runner produced before failing (trace, tool calls...). */
export class RunnerError extends Error {
  constructor(
    message: string,
    public partial: Partial<RunnerOutput> = {},
  ) {
    super(message);
  }
}

export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, t]) : t;
}
