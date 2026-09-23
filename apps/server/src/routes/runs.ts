import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { cancelActiveRun } from "../engine/worker";
import { runEvents } from "../lib/events";
import { HttpError, notFound, param, parseBody } from "../lib/http";
import { assertRole, projectId } from "../middleware/auth";
import { createRun } from "./suites";

export const runsRouter = Router({ mergeParams: true });

async function getRun(req: Request, id = param(req, "id")) {
  const run = await prisma.run.findFirst({ where: { id, projectId: projectId(req) }, include: { suite: { select: { id: true, name: true } } } });
  if (!run) throw notFound("Run");
  return run;
}

runsRouter.get("/", async (req, res) => {
  const q = z
    .object({ suiteId: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() })
    .parse(req.query);
  const runs = await prisma.run.findMany({
    where: { projectId: projectId(req), ...(q.suiteId && { suiteId: q.suiteId }), ...(q.status && { status: q.status as never }) },
    include: { suite: { select: { id: true, name: true } }, triggeredBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: q.limit + 1,
    ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
  });
  res.json({ runs: runs.slice(0, q.limit), nextCursor: runs.length > q.limit ? runs[q.limit - 1].id : null });
});

/** Compare two runs of (usually) the same suite: regressions / improvements per case × target. */
runsRouter.get("/compare", async (req, res) => {
  const { base, head } = z.object({ base: z.string(), head: z.string() }).parse(req.query);
  const [baseRun, headRun] = await Promise.all([getRun(req, base), getRun(req, head)]);
  const [baseResults, headResults] = await Promise.all(
    [baseRun, headRun].map((r) =>
      prisma.runResult.findMany({
        where: { runId: r.id },
        select: { id: true, testCaseId: true, targetId: true, caseName: true, targetName: true, status: true, humanStatus: true, score: true, latencyMs: true, costUsd: true, output: true },
      }),
    ),
  );
  const key = (r: { testCaseId: string | null; caseName: string; targetId: string | null; targetName: string }) =>
    `${r.testCaseId ?? r.caseName}::${r.targetId ?? r.targetName}`;
  const baseMap = new Map(baseResults.map((r) => [key(r), r]));
  const effective = (r?: { status: string; humanStatus: string | null }) => (r ? (r.humanStatus ?? r.status) : null);
  const rows = headResults.map((h) => {
    const b = baseMap.get(key(h));
    baseMap.delete(key(h));
    const bs = effective(b);
    const hs = effective(h);
    const change =
      !b ? "new" : bs === hs ? (h.score !== null && b.score !== null && Math.abs(h.score - b.score) > 0.1 ? (h.score > b.score ? "better" : "worse") : "same") : hs === "PASS" ? "fixed" : bs === "PASS" ? "regressed" : "changed";
    return { key: key(h), caseName: h.caseName, targetName: h.targetName, base: b ?? null, head: h, change };
  });
  for (const b of baseMap.values()) rows.push({ key: key(b), caseName: b.caseName, targetName: b.targetName, base: b, head: null as never, change: "removed" });
  const count = (c: string) => rows.filter((r) => r.change === c).length;
  res.json({
    base: baseRun,
    head: headRun,
    summary: { regressed: count("regressed"), fixed: count("fixed"), worse: count("worse"), better: count("better"), same: count("same"), changed: count("changed"), new: count("new"), removed: count("removed") },
    rows,
  });
});

runsRouter.get("/:id", async (req, res) => {
  const run = await getRun(req);
  const results = await prisma.runResult.findMany({
    where: { runId: run.id },
    include: { evaluations: true },
    orderBy: [{ caseName: "asc" }, { targetName: "asc" }],
  });
  res.json({ ...run, results });
});

runsRouter.get("/:id/results/:resultId", async (req, res) => {
  const run = await getRun(req);
  const result = await prisma.runResult.findFirst({ where: { id: param(req, "resultId"), runId: run.id }, include: { evaluations: true } });
  if (!result) throw notFound("Result");
  res.json(result);
});

/** Server-sent events with live progress for a run. */
runsRouter.get("/:id/events", async (req, res) => {
  const run = await getRun(req);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "status", status: run.status, error: run.error ?? undefined });
  send({ type: "progress", completed: run.completed, total: run.total, passed: run.passed, failed: run.failed, errored: run.errored });
  const unsubscribe = runEvents.subscribe(run.id, send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

runsRouter.post("/:id/cancel", async (req, res) => {
  assertRole(req, "EDITOR");
  const run = await getRun(req);
  if (!["QUEUED", "RUNNING"].includes(run.status)) throw new HttpError(400, `Run is already ${run.status.toLowerCase()}`);
  const wasActive = cancelActiveRun(run.id);
  if (!wasActive) {
    // queued (or orphaned) — mark directly
    await prisma.run.update({ where: { id: run.id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    runEvents.publish(run.id, { type: "status", status: "CANCELLED" });
  }
  res.json({ ok: true });
});

runsRouter.post("/:id/rerun", async (req, res) => {
  assertRole(req, "EDITOR");
  const run = await getRun(req);
  const next = await createRun({
    projectId: run.projectId,
    suiteId: run.suiteId,
    userId: req.user!.id,
    via: "ui",
    input: { targetIds: run.targetIds, tags: run.tags, name: run.name || undefined, concurrency: run.concurrency },
  });
  res.status(201).json(next);
});

runsRouter.delete("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const run = await getRun(req);
  if (run.status === "RUNNING") throw new HttpError(400, "Cancel the run before deleting it");
  await prisma.run.delete({ where: { id: run.id } });
  res.json({ ok: true });
});

/** Human review: override the automatic verdict of a result. */
runsRouter.post("/:id/results/:resultId/review", async (req, res) => {
  assertRole(req, "EDITOR");
  const run = await getRun(req);
  const body = parseBody(z.object({ status: z.enum(["PASS", "FAIL"]).nullable(), note: z.string().max(4000).default("") }), req);
  const result = await prisma.runResult.findFirst({ where: { id: param(req, "resultId"), runId: run.id } });
  if (!result) throw notFound("Result");
  const updated = await prisma.runResult.update({
    where: { id: result.id },
    data: {
      humanStatus: body.status,
      reviewNote: body.status ? body.note : null,
      reviewedById: body.status ? req.user!.id : null,
      reviewedAt: body.status ? new Date() : null,
    },
    include: { evaluations: true },
  });
  res.json(updated);
});
