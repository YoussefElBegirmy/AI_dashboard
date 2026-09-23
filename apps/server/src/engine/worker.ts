import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { evaluatorListSchema, suiteSettingsSchema, type EvaluationOutcome, type Evaluator, type RunnerOutput } from "@aieval/shared";
import { prisma } from "../db";
import { runEvents } from "../lib/events";
import { engineDeps, evalTransport } from "./deps";
import { evaluateAll, verdict, type EvalDeps } from "./evaluators";
import { runTarget } from "./runners";
import { loadSecrets } from "./secrets";
import { RunnerError, type EngineDeps, type TargetLike } from "./types";

const active = new Map<string, AbortController>();

const json = (v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

export function cancelActiveRun(runId: string): boolean {
  const c = active.get(runId);
  c?.abort(new Error("Run cancelled"));
  return Boolean(c);
}

/** Case evaluators are appended to suite evaluators; ids are made unique. */
function mergeEvaluators(suiteEvals: Evaluator[], caseEvals: Evaluator[], useSuite: boolean): Evaluator[] {
  const list = [...(useSuite ? suiteEvals : []), ...caseEvals];
  const seen = new Set<string>();
  return list.map((e) => {
    let id = e.id;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
}

/**
 * Connects every MCP server the run's targets use (directly, via an LLM agent loop, or
 * inside a workflow) before timing starts, so a stdio server's spawn time isn't billed
 * as latency to the first cases. Connection errors surface later, per case.
 */
async function warmUpMcpServers(targets: TargetLike[], projectId: string, secrets: Record<string, string>, deps: EngineDeps) {
  const serverIds = new Set<string>();
  const seen = new Set<string>();
  const visit = async (t: TargetLike | null) => {
    if (!t || seen.has(t.id)) return;
    seen.add(t.id);
    const c = (t.config ?? {}) as { serverId?: string; mcpServerIds?: string[]; steps?: { targetId: string }[] };
    if (t.kind === "MCP_TOOL" && c.serverId) serverIds.add(c.serverId);
    if (t.kind === "OPENROUTER_MODEL") c.mcpServerIds?.forEach((id) => serverIds.add(id));
    if (t.kind === "WORKFLOW") for (const s of c.steps ?? []) await visit(await deps.loadTarget(projectId, s.targetId));
  };
  for (const t of targets) await visit(t);
  await Promise.all(
    [...serverIds].map(async (id) => {
      const server = await deps.loadMcpServer(projectId, id);
      if (server) await deps.mcp.capabilities(server, secrets).catch(() => {});
    }),
  );
}

export async function executeRun(runId: string, deps: EngineDeps = engineDeps, transport: Pick<EvalDeps, "jev" | "fetch"> = evalTransport): Promise<void> {
  const claimed = await prisma.run.updateMany({ where: { id: runId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (!claimed.count) return;

  const controller = new AbortController();
  active.set(runId, controller);
  runEvents.publish(runId, { type: "status", status: "RUNNING" });

  try {
    const run = await prisma.run.findUniqueOrThrow({
      where: { id: runId },
      include: { suite: { include: { cases: { where: { enabled: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } } },
    });
    const settings = suiteSettingsSchema.parse(run.suite.settings ?? {});
    const suiteEvals = evaluatorListSchema.parse(run.suite.evaluators ?? []);
    const cases = run.tags.length ? run.suite.cases.filter((c) => c.tags.some((t) => run.tags.includes(t))) : run.suite.cases;
    const targets = await prisma.target.findMany({ where: { id: { in: run.targetIds }, projectId: run.projectId } });
    if (!targets.length) throw new Error("None of the selected targets exist");
    if (!cases.length) throw new Error("Suite has no enabled test cases");
    const secrets = await loadSecrets(run.projectId);
    await warmUpMcpServers(targets, run.projectId, secrets, deps);

    const pending = await prisma.runResult.createManyAndReturn({
      data: cases.flatMap((c) =>
        targets.map((t) => ({
          runId,
          testCaseId: c.id,
          targetId: t.id,
          caseName: c.name,
          targetName: t.name,
          input: json(c.input),
          expected: json(c.expected),
        })),
      ),
    });
    await prisma.run.update({ where: { id: runId }, data: { total: pending.length } });
    runEvents.publish(runId, { type: "progress", completed: 0, total: pending.length, passed: 0, failed: 0, errored: 0 });

    const caseById = new Map(cases.map((c) => [c.id, c]));
    const targetById = new Map(targets.map((t) => [t.id, t]));
    const limit = pLimit(run.concurrency || settings.concurrency);

    await Promise.all(
      pending.map((row) =>
        limit(async () => {
          if (controller.signal.aborted) return;
          const tc = caseById.get(row.testCaseId!)!;
          const target = targetById.get(row.targetId!)!;
          const evaluators = mergeEvaluators(suiteEvals, evaluatorListSchema.parse(tc.evaluators ?? []), tc.useSuiteEvaluators);

          let out: Partial<RunnerOutput> = {};
          let error: string | undefined;
          try {
            out = await runTarget(target, { projectId: run.projectId, secrets, input: tc.input, expected: tc.expected, signal: controller.signal, depth: 0, deps });
          } catch (err) {
            error = (err as Error).message;
            if (err instanceof RunnerError) out = err.partial;
          }
          if (controller.signal.aborted) return;

          let outcomes: EvaluationOutcome[] = [];
          let status: "PASS" | "FAIL" | "ERROR" = "ERROR";
          let score: number | null = null;
          let needsReview = false;
          if (!error) {
            outcomes = await evaluateAll(
              evaluators,
              {
                input: tc.input,
                expected: tc.expected,
                output: out.output ?? "",
                outputJson: out.outputJson,
                statusCode: out.statusCode,
                latencyMs: out.latencyMs ?? 0,
                costUsd: out.usage?.costUsd,
                toolCalls: out.toolCalls ?? [],
              },
              { secrets, settings, signal: controller.signal, ...transport },
            );
            ({ status, score, needsReview } = verdict(outcomes));
          }

          await prisma.$transaction([
            prisma.runResult.update({
              where: { id: row.id },
              data: {
                status,
                output: out.output ?? null,
                outputJson: json(out.outputJson),
                raw: json(out.raw),
                statusCode: out.statusCode ?? null,
                latencyMs: out.latencyMs !== undefined ? Math.round(out.latencyMs) : null,
                inputTokens: out.usage?.inputTokens ?? null,
                outputTokens: out.usage?.outputTokens ?? null,
                costUsd: out.usage?.costUsd ?? null,
                toolCalls: json(out.toolCalls?.length ? out.toolCalls : null),
                trace: json(out.trace?.length ? out.trace : null),
                error: error ?? null,
                score,
                needsReview,
                finishedAt: new Date(),
              },
            }),
            prisma.evaluationResult.createMany({
              data: outcomes.map((o) => ({
                runResultId: row.id,
                evaluatorId: o.evaluatorId,
                name: o.name,
                type: o.type,
                pass: o.pass,
                score: o.score,
                needsReview: o.needsReview,
                required: o.required,
                weight: o.weight,
                reasoning: o.reasoning ?? null,
                details: json(o.details),
                error: o.error ?? null,
              })),
            }),
          ]);
          const updated = await prisma.run.update({
            where: { id: runId },
            data: {
              completed: { increment: 1 },
              ...(status === "PASS" && { passed: { increment: 1 } }),
              ...(status === "FAIL" && { failed: { increment: 1 } }),
              ...(status === "ERROR" && { errored: { increment: 1 } }),
            },
          });
          runEvents.publish(runId, { type: "result", resultId: row.id, testCaseId: row.testCaseId, targetId: row.targetId, status });
          runEvents.publish(runId, { type: "progress", completed: updated.completed, total: updated.total, passed: updated.passed, failed: updated.failed, errored: updated.errored });
        }),
      ),
    );

    const agg = await prisma.runResult.aggregate({
      where: { runId, status: { not: "PENDING" } },
      _avg: { score: true, latencyMs: true },
      _sum: { costUsd: true },
    });
    const cancelled = controller.signal.aborted;
    if (cancelled) {
      await prisma.runResult.updateMany({ where: { runId, status: "PENDING" }, data: { status: "ERROR", error: "Cancelled" } });
    }
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: cancelled ? "CANCELLED" : "COMPLETED",
        finishedAt: new Date(),
        avgScore: agg._avg.score,
        avgLatencyMs: agg._avg.latencyMs,
        totalCostUsd: agg._sum.costUsd ?? 0,
      },
    });
    runEvents.publish(runId, { type: "status", status: cancelled ? "CANCELLED" : "COMPLETED" });
  } catch (err) {
    const message = (err as Error).message;
    await prisma.run.update({ where: { id: runId }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    runEvents.publish(runId, { type: "status", status: "FAILED", error: message });
  } finally {
    active.delete(runId);
  }
}
