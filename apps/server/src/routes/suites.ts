import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { runInputSchema, suiteInputSchema, testCaseInputSchema, type TestCaseInput } from "@aieval/shared";
import { prisma } from "../db";
import { enqueueRun } from "../engine/queue";
import { HttpError, notFound, param, parseBody } from "../lib/http";
import { assertRole, projectId } from "../middleware/auth";

export const suitesRouter = Router({ mergeParams: true });

const j = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

async function getSuite(req: Request) {
  const suite = await prisma.suite.findFirst({ where: { id: param(req, "id"), projectId: projectId(req) } });
  if (!suite) throw notFound("Suite");
  return suite;
}

function caseData(c: TestCaseInput) {
  return {
    name: c.name,
    input: j(c.input ?? {}) as Prisma.InputJsonValue,
    expected: j(c.expected),
    tags: c.tags,
    evaluators: c.evaluators as Prisma.InputJsonValue,
    useSuiteEvaluators: c.useSuiteEvaluators,
    enabled: c.enabled,
  };
}

suitesRouter.get("/", async (req, res) => {
  const suites = await prisma.suite.findMany({
    where: { projectId: projectId(req) },
    include: {
      _count: { select: { cases: true, runs: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, passed: true, failed: true, errored: true, total: true, createdAt: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(suites.map(({ runs, ...s }) => ({ ...s, lastRun: runs[0] ?? null })));
});

suitesRouter.post("/", async (req, res) => {
  assertRole(req, "EDITOR");
  const body = parseBody(suiteInputSchema, req);
  const suite = await prisma.suite.create({
    data: {
      projectId: projectId(req),
      name: body.name,
      description: body.description,
      evaluators: body.evaluators as Prisma.InputJsonValue,
      settings: body.settings as Prisma.InputJsonValue,
      defaultTargetIds: body.defaultTargetIds,
    },
  });
  res.status(201).json(suite);
});

suitesRouter.get("/:id", async (req, res) => {
  const suite = await prisma.suite.findFirst({
    where: { id: param(req, "id"), projectId: projectId(req) },
    include: { cases: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
  if (!suite) throw notFound("Suite");
  res.json(suite);
});

suitesRouter.put("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await getSuite(req);
  const body = parseBody(suiteInputSchema, req);
  res.json(
    await prisma.suite.update({
      where: { id: suite.id },
      data: {
        name: body.name,
        description: body.description,
        evaluators: body.evaluators as Prisma.InputJsonValue,
        settings: body.settings as Prisma.InputJsonValue,
        defaultTargetIds: body.defaultTargetIds,
      },
    }),
  );
});

suitesRouter.delete("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await getSuite(req);
  await prisma.suite.delete({ where: { id: suite.id } });
  res.json({ ok: true });
});

suitesRouter.post("/:id/duplicate", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await prisma.suite.findFirst({ where: { id: param(req, "id"), projectId: projectId(req) }, include: { cases: true } });
  if (!suite) throw notFound("Suite");
  const copy = await prisma.suite.create({
    data: {
      projectId: suite.projectId,
      name: `${suite.name} (copy)`,
      description: suite.description,
      evaluators: suite.evaluators as Prisma.InputJsonValue,
      settings: suite.settings as Prisma.InputJsonValue,
      defaultTargetIds: suite.defaultTargetIds,
      cases: {
        create: suite.cases.map((c) => ({
          name: c.name,
          input: c.input as Prisma.InputJsonValue,
          expected: j(c.expected),
          tags: c.tags,
          evaluators: c.evaluators as Prisma.InputJsonValue,
          useSuiteEvaluators: c.useSuiteEvaluators,
          enabled: c.enabled,
          position: c.position,
        })),
      },
    },
  });
  res.status(201).json(copy);
});

// ---- cases ----

suitesRouter.post("/:id/cases", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await getSuite(req);
  const body = parseBody(testCaseInputSchema, req);
  const max = await prisma.testCase.aggregate({ where: { suiteId: suite.id }, _max: { position: true } });
  const tc = await prisma.testCase.create({ data: { suiteId: suite.id, position: (max._max.position ?? -1) + 1, ...caseData(body) } });
  await prisma.suite.update({ where: { id: suite.id }, data: { updatedAt: new Date() } });
  res.status(201).json(tc);
});

suitesRouter.put("/:id/cases/:caseId", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await getSuite(req);
  const body = parseBody(testCaseInputSchema, req);
  const existing = await prisma.testCase.findFirst({ where: { id: param(req, "caseId"), suiteId: suite.id } });
  if (!existing) throw notFound("Test case");
  res.json(await prisma.testCase.update({ where: { id: existing.id }, data: caseData(body) }));
});

suitesRouter.delete("/:id/cases/:caseId", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await getSuite(req);
  await prisma.testCase.deleteMany({ where: { id: param(req, "caseId"), suiteId: suite.id } });
  res.json({ ok: true });
});

/** Bulk import (the UI parses CSV / JSONL into this shape). */
suitesRouter.post("/:id/cases/import", async (req, res) => {
  assertRole(req, "EDITOR");
  const suite = await getSuite(req);
  const body = parseBody(z.object({ mode: z.enum(["append", "replace"]).default("append"), cases: z.array(testCaseInputSchema).min(1).max(5000) }), req);
  const result = await prisma.$transaction(async (tx) => {
    if (body.mode === "replace") await tx.testCase.deleteMany({ where: { suiteId: suite.id } });
    const max = await tx.testCase.aggregate({ where: { suiteId: suite.id }, _max: { position: true } });
    const start = (max._max.position ?? -1) + 1;
    return tx.testCase.createMany({ data: body.cases.map((c, i) => ({ suiteId: suite.id, position: start + i, ...caseData(c) })) });
  });
  res.json({ imported: result.count });
});

suitesRouter.get("/:id/cases/export", async (req, res) => {
  const suite = await getSuite(req);
  const cases = await prisma.testCase.findMany({ where: { suiteId: suite.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  res.json(
    cases.map((c) => ({ name: c.name, input: c.input, expected: c.expected, tags: c.tags, evaluators: c.evaluators, useSuiteEvaluators: c.useSuiteEvaluators, enabled: c.enabled })),
  );
});

// ---- runs ----

export async function createRun(opts: { projectId: string; suiteId: string; userId: string; via: "ui" | "api"; input: z.infer<typeof runInputSchema> }) {
  const suite = await prisma.suite.findFirst({ where: { id: opts.suiteId, projectId: opts.projectId } });
  if (!suite) throw notFound("Suite");
  const targets = await prisma.target.findMany({ where: { projectId: opts.projectId, id: { in: opts.input.targetIds } } });
  if (targets.length !== new Set(opts.input.targetIds).size) throw new HttpError(400, "One or more targets were not found");
  const enabledCases = await prisma.testCase.count({
    where: { suiteId: suite.id, enabled: true, ...(opts.input.tags.length && { tags: { hasSome: opts.input.tags } }) },
  });
  if (!enabledCases) throw new HttpError(400, "No enabled test cases match");
  const settings = (suite.settings ?? {}) as { concurrency?: number };
  const run = await prisma.run.create({
    data: {
      projectId: opts.projectId,
      suiteId: suite.id,
      name: opts.input.name ?? "",
      targetIds: targets.map((t) => t.id),
      targetsSnapshot: Object.fromEntries(targets.map((t) => [t.id, { name: t.name, kind: t.kind, version: t.version }])),
      tags: opts.input.tags,
      concurrency: opts.input.concurrency ?? settings.concurrency ?? 4,
      total: enabledCases * targets.length,
      triggeredById: opts.userId,
      triggeredVia: opts.via,
    },
  });
  await enqueueRun(run.id);
  return run;
}

suitesRouter.post("/:id/runs", async (req, res) => {
  assertRole(req, "EDITOR");
  const input = parseBody(runInputSchema, req);
  const run = await createRun({ projectId: projectId(req), suiteId: param(req, "id"), userId: req.user!.id, via: req.tokenProjectId ? "api" : "ui", input });
  res.status(201).json(run);
});
