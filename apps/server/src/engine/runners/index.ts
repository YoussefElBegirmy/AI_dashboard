import { targetConfigSchemas, type RunnerOutput, type TargetConfigByKind, type TargetKind } from "@aieval/shared";
import { RunnerError, type RunContext, type TargetLike } from "../types";
import { runHttp } from "./http";
import { runMcpTool } from "./mcpTool";
import { runOpenRouter } from "./openrouter";
import { runWorkflow } from "./workflow";

function configOf<K extends TargetKind>(kind: K, target: TargetLike): TargetConfigByKind[K] {
  const r = targetConfigSchemas[kind].safeParse(target.config);
  if (!r.success) throw new RunnerError(`Invalid config for target "${target.name}": ${r.error.message}`);
  return r.data as TargetConfigByKind[K];
}

/**
 * Executes one target for one input. To support a new kind of endpoint, add a config
 * schema in packages/shared/src/targets.ts and a runner here.
 */
export async function runTarget(target: TargetLike, ctx: RunContext): Promise<RunnerOutput> {
  switch (target.kind) {
    case "OPENROUTER_MODEL":
      return runOpenRouter(configOf("OPENROUTER_MODEL", target), ctx);
    case "HTTP_ENDPOINT":
      return runHttp(configOf("HTTP_ENDPOINT", target), ctx);
    case "MCP_TOOL":
      return runMcpTool(configOf("MCP_TOOL", target), ctx);
    case "WORKFLOW":
      return runWorkflow(configOf("WORKFLOW", target), ctx, runTarget);
    default:
      throw new RunnerError(`Unsupported target kind ${(target as TargetLike).kind}`);
  }
}
