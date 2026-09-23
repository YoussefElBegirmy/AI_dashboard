import type { RunnerOutput, ToolCallRecord, TraceStep, WorkflowConfig } from "@aieval/shared";
import { render, renderDeep, tryParseJson } from "../template";
import { RunnerError, type RunContext } from "../types";
import type { runTarget as RunTargetFn } from "./index";

const MAX_DEPTH = 5;

/**
 * Runs steps in order. Each step calls another target with a templated input;
 * later steps can reference `{{steps.<name>.output}}` / `{{steps.<name>.outputJson.x}}`.
 */
export async function runWorkflow(cfg: WorkflowConfig, ctx: RunContext, runTarget: typeof RunTargetFn): Promise<RunnerOutput> {
  const started = Date.now();
  if (ctx.depth >= MAX_DEPTH) throw new RunnerError(`Workflow nesting deeper than ${MAX_DEPTH}`);

  const trace: TraceStep[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const steps: Record<string, { output: string; outputJson?: unknown; raw?: unknown; statusCode?: number; error?: string }> = {};
  let lastOutput: RunnerOutput | undefined;

  const partial = () => ({ trace, toolCalls, usage, latencyMs: Date.now() - started });

  for (const step of cfg.steps) {
    ctx.signal?.throwIfAborted();
    const target = await ctx.deps.loadTarget(ctx.projectId, step.targetId);
    if (!target) throw new RunnerError(`Step "${step.name}": target ${step.targetId} not found`, partial());

    const tctx = { input: ctx.input, expected: ctx.expected, secrets: ctx.secrets, steps };
    const stepInput = renderDeep(step.input, tctx);
    const t0 = Date.now();
    try {
      const out = await runTarget(target, { ...ctx, input: stepInput, depth: ctx.depth + 1 });
      lastOutput = out;
      steps[step.name] = { output: out.output, outputJson: out.outputJson, raw: out.raw, statusCode: out.statusCode };
      trace.push({
        name: step.name,
        targetId: target.id,
        targetName: target.name,
        kind: target.kind,
        input: stepInput,
        output: out.output,
        outputJson: out.outputJson,
        latencyMs: Date.now() - t0,
        costUsd: out.usage?.costUsd,
      });
      usage.inputTokens += out.usage?.inputTokens ?? 0;
      usage.outputTokens += out.usage?.outputTokens ?? 0;
      usage.costUsd += out.usage?.costUsd ?? 0;
      if (out.toolCalls) toolCalls.push(...out.toolCalls);
      if (out.trace) trace.push(...out.trace.map((t) => ({ ...t, name: `${step.name} › ${t.name}` })));
    } catch (err) {
      const message = (err as Error).message;
      const p = err instanceof RunnerError ? err.partial : {};
      if (p.toolCalls) toolCalls.push(...p.toolCalls);
      trace.push({ name: step.name, targetId: target.id, targetName: target.name, kind: target.kind, input: stepInput, output: p.output ?? "", latencyMs: Date.now() - t0, error: message });
      steps[step.name] = { output: "", error: message };
      if (!step.continueOnError) throw new RunnerError(`Step "${step.name}" failed: ${message}`, partial());
    }
  }

  const output = cfg.outputTemplate
    ? render(cfg.outputTemplate, { input: ctx.input, expected: ctx.expected, secrets: ctx.secrets, steps })
    : (lastOutput?.output ?? "");
  return {
    output,
    outputJson: cfg.outputTemplate ? tryParseJson(output) : lastOutput?.outputJson,
    raw: { steps },
    statusCode: lastOutput?.statusCode,
    latencyMs: Date.now() - started,
    usage,
    toolCalls,
    trace,
  };
}
