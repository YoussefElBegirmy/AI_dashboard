import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, notFound, param, parseBody } from "../lib/http";
import { requireUser } from "../middleware/auth";
import { createRun } from "./suites";

/**
 * CI-friendly API. Authenticate with `Authorization: Bearer aie_…` (Settings → API tokens).
 *   POST /api/v1/suites/:suiteId/runs   { targetIds?, tags?, name? }  → { id, status, url }
 *   GET  /api/v1/runs/:runId                                          → summary (poll until finished)
 */
export const v1Router = Router();
v1Router.use(requireUser);
v1Router.use((req, _res, next) => (req.tokenProjectId ? next() : next(new HttpError(401, "Use an API token (Authorization: Bearer aie_…)"))));

v1Router.post("/suites/:suiteId/runs", async (req, res) => {
  const pid = req.tokenProjectId!;
  const membership = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: req.user!.id } } });
  if (!membership || membership.role === "VIEWER") throw new HttpError(403, "Token owner needs editor access");
  const body = parseBody(z.object({ targetIds: z.array(z.string()).optional(), tags: z.array(z.string()).default([]), name: z.string().optional() }), req);
  const suite = await prisma.suite.findFirst({ where: { id: param(req, "suiteId"), projectId: pid } });
  if (!suite) throw notFound("Suite");
  const targetIds = body.targetIds?.length ? body.targetIds : suite.defaultTargetIds;
  if (!targetIds.length) throw new HttpError(400, "Pass targetIds or set default targets on the suite");
  const run = await createRun({ projectId: pid, suiteId: suite.id, userId: req.user!.id, via: "api", input: { targetIds, tags: body.tags, name: body.name } });
  res.status(201).json({ id: run.id, status: run.status, url: `/p/${pid}/runs/${run.id}` });
});

v1Router.get("/runs/:runId", async (req, res) => {
  const run = await prisma.run.findFirst({ where: { id: param(req, "runId"), projectId: req.tokenProjectId! } });
  if (!run) throw notFound("Run");
  const finished = ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);
  res.json({
    id: run.id,
    status: run.status,
    finished,
    total: run.total,
    completed: run.completed,
    passed: run.passed,
    failed: run.failed,
    errored: run.errored,
    passRate: run.total ? run.passed / run.total : null,
    avgScore: run.avgScore,
    totalCostUsd: run.totalCostUsd,
    error: run.error,
  });
});
