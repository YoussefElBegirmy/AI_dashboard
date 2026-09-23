import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { targetConfigSchemas, targetInputSchema, TARGET_KINDS, type TargetKind } from "@aieval/shared";
import { prisma } from "../db";
import { engineDeps } from "../engine/deps";
import { runTarget } from "../engine/runners";
import { loadSecrets } from "../engine/secrets";
import { RunnerError } from "../engine/types";
import { HttpError, notFound, param, parseBody, parseWith } from "../lib/http";
import { assertRole, projectId } from "../middleware/auth";

export const targetsRouter = Router({ mergeParams: true });

async function validateConfig(pid: string, kind: TargetKind, config: unknown, selfId?: string) {
  const parsed = parseWith(targetConfigSchemas[kind], config, "Invalid target config") as Record<string, unknown>;
  if (kind === "WORKFLOW") {
    const steps = parsed.steps as { name: string; targetId: string }[];
    const names = new Set<string>();
    for (const s of steps) {
      if (names.has(s.name)) throw new HttpError(400, `Duplicate step name "${s.name}"`);
      names.add(s.name);
      if (s.targetId === selfId) throw new HttpError(400, "A workflow cannot call itself");
    }
    const found = await prisma.target.count({ where: { projectId: pid, id: { in: steps.map((s) => s.targetId) } } });
    if (found !== new Set(steps.map((s) => s.targetId)).size) throw new HttpError(400, "A workflow step references a missing target");
  }
  if (kind === "MCP_TOOL") {
    const server = await prisma.mcpServer.findFirst({ where: { projectId: pid, id: parsed.serverId as string } });
    if (!server) throw new HttpError(400, "MCP server not found");
  }
  if (kind === "OPENROUTER_MODEL") {
    const ids = parsed.mcpServerIds as string[];
    if (ids.length && (await prisma.mcpServer.count({ where: { projectId: pid, id: { in: ids } } })) !== ids.length) {
      throw new HttpError(400, "An attached MCP server was not found");
    }
  }
  return parsed as Prisma.InputJsonValue;
}

targetsRouter.get("/", async (req, res) => {
  const targets = await prisma.target.findMany({ where: { projectId: projectId(req) }, orderBy: { updatedAt: "desc" } });
  // last 50 results per target for quick stats
  const stats = await prisma.runResult.groupBy({
    by: ["targetId"],
    where: { targetId: { in: targets.map((t) => t.id) }, status: { in: ["PASS", "FAIL", "ERROR"] }, createdAt: { gt: new Date(Date.now() - 30 * 86400_000) } },
    _count: { _all: true },
    _avg: { latencyMs: true, costUsd: true, score: true },
  });
  const passes = await prisma.runResult.groupBy({
    by: ["targetId"],
    where: { targetId: { in: targets.map((t) => t.id) }, status: "PASS", createdAt: { gt: new Date(Date.now() - 30 * 86400_000) } },
    _count: { _all: true },
  });
  res.json(
    targets.map((t) => {
      const s = stats.find((x) => x.targetId === t.id);
      const p = passes.find((x) => x.targetId === t.id);
      return {
        ...t,
        stats: s ? { results: s._count._all, passRate: (p?._count._all ?? 0) / s._count._all, avgLatencyMs: s._avg.latencyMs, avgCostUsd: s._avg.costUsd, avgScore: s._avg.score } : null,
      };
    }),
  );
});

targetsRouter.post("/", async (req, res) => {
  assertRole(req, "EDITOR");
  const body = parseBody(targetInputSchema, req);
  const config = await validateConfig(projectId(req), body.kind, body.config);
  const target = await prisma.target.create({ data: { projectId: projectId(req), name: body.name, description: body.description, kind: body.kind, config } });
  res.status(201).json(target);
});

targetsRouter.get("/:id", async (req, res) => {
  const target = await prisma.target.findFirst({ where: { id: param(req, "id"), projectId: projectId(req) } });
  if (!target) throw notFound("Target");
  res.json(target);
});

targetsRouter.put("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const existing = await prisma.target.findFirst({ where: { id: param(req, "id"), projectId: projectId(req) } });
  if (!existing) throw notFound("Target");
  const body = parseBody(targetInputSchema, req);
  const config = await validateConfig(projectId(req), body.kind, body.config, existing.id);
  const changed = JSON.stringify(config) !== JSON.stringify(existing.config) || body.kind !== existing.kind;
  const target = await prisma.target.update({
    where: { id: existing.id },
    data: { name: body.name, description: body.description, kind: body.kind, config, ...(changed && { version: { increment: 1 } }) },
  });
  res.json(target);
});

targetsRouter.delete("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const id = param(req, "id");
  const workflows = await prisma.target.findMany({ where: { projectId: projectId(req), kind: "WORKFLOW" } });
  const usedBy = workflows.filter((w) => JSON.stringify(w.config).includes(`"${id}"`));
  if (usedBy.length) throw new HttpError(400, `Used by workflow(s): ${usedBy.map((w) => w.name).join(", ")}`);
  await prisma.target.deleteMany({ where: { id, projectId: projectId(req) } });
  res.json({ ok: true });
});

targetsRouter.post("/:id/duplicate", async (req, res) => {
  assertRole(req, "EDITOR");
  const t = await prisma.target.findFirst({ where: { id: param(req, "id"), projectId: projectId(req) } });
  if (!t) throw notFound("Target");
  const copy = await prisma.target.create({
    data: { projectId: t.projectId, name: `${t.name} (copy)`, description: t.description, kind: t.kind, config: t.config as Prisma.InputJsonValue },
  });
  res.status(201).json(copy);
});

const trySchema = z.object({
  kind: z.enum(TARGET_KINDS),
  config: z.unknown(),
  input: z.unknown().default({}),
  expected: z.unknown().default(null),
  targetId: z.string().optional(),
});

/** Executes an (unsaved) target config once — the "Try it" panel. */
targetsRouter.post("/try", async (req, res) => {
  assertRole(req, "EDITOR");
  const body = parseBody(trySchema, req);
  const pid = projectId(req);
  const config = parseWith(targetConfigSchemas[body.kind], body.config, "Invalid target config");
  const secrets = await loadSecrets(pid);
  const controller = new AbortController();
  res.on("close", () => !res.writableFinished && controller.abort());
  try {
    const out = await runTarget(
      { id: body.targetId ?? "try", projectId: pid, name: "Try it", kind: body.kind, config },
      { projectId: pid, secrets, input: body.input, expected: body.expected, depth: 0, deps: engineDeps, signal: controller.signal },
    );
    res.json({ ok: true, ...out });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message, ...(err instanceof RunnerError ? err.partial : {}) });
  }
});
