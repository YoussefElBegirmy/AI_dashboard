import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { projectId } from "../middleware/auth";

export const metricsRouter = Router({ mergeParams: true });

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  suiteId: z.string().optional(),
  targetIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(",").filter(Boolean))),
  bucket: z.enum(["hour", "day", "week"]).default("day"),
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Aggregated metrics for charts. All queries run over finished results in the window,
 * using the human verdict when a reviewer overrode the automatic one.
 */
metricsRouter.get("/", async (req, res) => {
  const q = querySchema.parse(req.query);
  const pid = projectId(req);
  const since = new Date(Date.now() - q.days * 86400_000);

  const where = Prisma.sql`r."projectId" = ${pid} AND rr."createdAt" >= ${since} AND rr.status <> 'PENDING'
    ${q.suiteId ? Prisma.sql`AND r."suiteId" = ${q.suiteId}` : Prisma.empty}
    ${q.targetIds.length ? Prisma.sql`AND rr."targetId" IN (${Prisma.join(q.targetIds)})` : Prisma.empty}`;
  const from = Prisma.sql`FROM "RunResult" rr JOIN "Run" r ON r.id = rr."runId"`;
  const eff = Prisma.sql`COALESCE(rr."humanStatus", rr.status)`;
  const bucket = Prisma.raw(`'${q.bucket}'`);

  const [kpiRows, trend, byTarget, evaluators, tags, histogram, runs, toolUsage] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*)::int AS results,
        COUNT(DISTINCT rr."runId")::int AS runs,
        AVG(CASE WHEN ${eff} = 'PASS' THEN 1.0 ELSE 0 END) AS "passRate",
        AVG(CASE WHEN rr.status = 'ERROR' THEN 1.0 ELSE 0 END) AS "errorRate",
        AVG(rr.score) AS "avgScore",
        AVG(rr."latencyMs") AS "avgLatencyMs",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY rr."latencyMs") AS "p50LatencyMs",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY rr."latencyMs") AS "p95LatencyMs",
        COALESCE(SUM(rr."costUsd"), 0) AS "totalCostUsd",
        COALESCE(SUM(rr."inputTokens"), 0)::bigint AS "inputTokens",
        COALESCE(SUM(rr."outputTokens"), 0)::bigint AS "outputTokens",
        SUM(CASE WHEN rr."needsReview" AND rr."humanStatus" IS NULL THEN 1 ELSE 0 END)::int AS "needsReview",
        SUM(CASE WHEN rr."humanStatus" IS NOT NULL THEN 1 ELSE 0 END)::int AS "reviewed"
      ${from} WHERE ${where}`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT date_trunc(${bucket}, rr."createdAt") AS bucket, rr."targetId", MAX(rr."targetName") AS "targetName",
        COUNT(*)::int AS results,
        AVG(CASE WHEN ${eff} = 'PASS' THEN 1.0 ELSE 0 END) AS "passRate",
        AVG(rr.score) AS "avgScore",
        AVG(rr."latencyMs") AS "avgLatencyMs",
        COALESCE(SUM(rr."costUsd"), 0) AS "costUsd"
      ${from} WHERE ${where}
      GROUP BY 1, 2 ORDER BY 1`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT rr."targetId", MAX(rr."targetName") AS "targetName",
        COUNT(*)::int AS results,
        SUM(CASE WHEN ${eff} = 'PASS' THEN 1 ELSE 0 END)::int AS passed,
        SUM(CASE WHEN ${eff} = 'FAIL' THEN 1 ELSE 0 END)::int AS failed,
        SUM(CASE WHEN rr.status = 'ERROR' THEN 1 ELSE 0 END)::int AS errored,
        AVG(rr.score) AS "avgScore",
        AVG(rr."latencyMs") AS "avgLatencyMs",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY rr."latencyMs") AS "p50LatencyMs",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY rr."latencyMs") AS "p95LatencyMs",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY rr."latencyMs") AS "p99LatencyMs",
        COALESCE(SUM(rr."costUsd"), 0) AS "totalCostUsd",
        AVG(rr."costUsd") AS "avgCostUsd",
        COALESCE(SUM(rr."inputTokens"), 0)::bigint AS "inputTokens",
        COALESCE(SUM(rr."outputTokens"), 0)::bigint AS "outputTokens",
        SUM(CASE WHEN rr."needsReview" THEN 1 ELSE 0 END)::int AS "needsReview"
      ${from} WHERE ${where}
      GROUP BY rr."targetId" ORDER BY "passed" DESC`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT e.name, e.type,
        COUNT(*)::int AS count,
        AVG(CASE WHEN e.pass THEN 1.0 ELSE 0 END) AS "passRate",
        AVG(e.score) AS "avgScore",
        AVG(NULLIF(e.details -> 'answer' ->> 'confidence', '')::float) AS "avgConfidence",
        SUM(CASE WHEN e."needsReview" THEN 1 ELSE 0 END)::int AS "needsReview",
        SUM(CASE WHEN e.error IS NOT NULL THEN 1 ELSE 0 END)::int AS errors
      FROM "EvaluationResult" e JOIN "RunResult" rr ON rr.id = e."runResultId" JOIN "Run" r ON r.id = rr."runId"
      WHERE ${where}
      GROUP BY e.name, e.type ORDER BY count DESC LIMIT 50`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tag, COUNT(*)::int AS results,
        AVG(CASE WHEN ${eff} = 'PASS' THEN 1.0 ELSE 0 END) AS "passRate",
        AVG(rr.score) AS "avgScore"
      ${from} JOIN "TestCase" tc ON tc.id = rr."testCaseId" CROSS JOIN LATERAL unnest(tc.tags) AS tag
      WHERE ${where}
      GROUP BY tag ORDER BY results DESC LIMIT 30`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT LEAST(FLOOR(rr.score * 10), 9)::int AS bin, COUNT(*)::int AS count
      ${from} WHERE ${where} AND rr.score IS NOT NULL
      GROUP BY 1 ORDER BY 1`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT r.id, r."createdAt", r.name, s.name AS "suiteName", r.total, r.passed, r.failed, r.errored,
        r."avgScore", r."avgLatencyMs", r."totalCostUsd"
      FROM "Run" r JOIN "Suite" s ON s.id = r."suiteId"
      WHERE r."projectId" = ${pid} AND r."createdAt" >= ${since} AND r.status IN ('COMPLETED', 'CANCELLED')
        ${q.suiteId ? Prisma.sql`AND r."suiteId" = ${q.suiteId}` : Prisma.empty}
      ORDER BY r."createdAt" DESC LIMIT 50`,

    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tc->>'alias' AS tool, COUNT(*)::int AS calls,
        SUM(CASE WHEN (tc->>'isError')::boolean THEN 1 ELSE 0 END)::int AS errors,
        AVG((tc->>'latencyMs')::float) AS "avgLatencyMs"
      ${from} CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(rr."toolCalls") = 'array' THEN rr."toolCalls" ELSE '[]'::jsonb END) AS tc
      WHERE ${where}
      GROUP BY 1 ORDER BY calls DESC LIMIT 30`,
  ]);

  const k = kpiRows[0] ?? {};
  const bins = Array.from({ length: 10 }, (_, i) => ({ bin: i, label: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`, count: 0 }));
  for (const h of histogram) bins[Number(h.bin)].count = Number(h.count);

  res.json({
    window: { days: q.days, since, bucket: q.bucket },
    kpis: {
      results: num(k.results) ?? 0,
      runs: num(k.runs) ?? 0,
      passRate: num(k.passRate),
      errorRate: num(k.errorRate),
      avgScore: num(k.avgScore),
      avgLatencyMs: num(k.avgLatencyMs),
      p50LatencyMs: num(k.p50LatencyMs),
      p95LatencyMs: num(k.p95LatencyMs),
      totalCostUsd: num(k.totalCostUsd) ?? 0,
      inputTokens: num(k.inputTokens) ?? 0,
      outputTokens: num(k.outputTokens) ?? 0,
      needsReview: num(k.needsReview) ?? 0,
      reviewed: num(k.reviewed) ?? 0,
    },
    trend: trend.map((t) => ({
      bucket: t.bucket,
      targetId: t.targetId,
      targetName: t.targetName,
      results: num(t.results),
      passRate: num(t.passRate),
      avgScore: num(t.avgScore),
      avgLatencyMs: num(t.avgLatencyMs),
      costUsd: num(t.costUsd),
    })),
    byTarget: byTarget.map((t) => Object.fromEntries(Object.entries(t).map(([key, v]) => [key, key === "targetId" || key === "targetName" ? v : num(v)]))),
    evaluators: evaluators.map((e) => ({ name: e.name, type: e.type, count: num(e.count), passRate: num(e.passRate), avgScore: num(e.avgScore), avgConfidence: num(e.avgConfidence), needsReview: num(e.needsReview), errors: num(e.errors) })),
    tags: tags.map((t) => ({ tag: t.tag, results: num(t.results), passRate: num(t.passRate), avgScore: num(t.avgScore) })),
    scoreHistogram: bins,
    runs: runs
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        name: r.name,
        suiteName: r.suiteName,
        total: num(r.total),
        passRate: Number(r.total) ? Number(r.passed) / Number(r.total) : null,
        avgScore: num(r.avgScore),
        avgLatencyMs: num(r.avgLatencyMs),
        totalCostUsd: num(r.totalCostUsd),
      }))
      .reverse(),
    toolUsage: toolUsage.map((t) => ({ tool: t.tool, calls: num(t.calls), errors: num(t.errors), avgLatencyMs: num(t.avgLatencyMs) })),
  });
});

/** Compact numbers for the project home page. */
metricsRouter.get("/overview", async (req, res) => {
  const pid = projectId(req);
  const [targets, suites, cases, mcpServers, mcpHealthy, runsActive, recentRuns] = await Promise.all([
    prisma.target.count({ where: { projectId: pid } }),
    prisma.suite.count({ where: { projectId: pid } }),
    prisma.testCase.count({ where: { suite: { projectId: pid } } }),
    prisma.mcpServer.count({ where: { projectId: pid } }),
    prisma.mcpServer.count({ where: { projectId: pid, status: "connected" } }),
    prisma.run.count({ where: { projectId: pid, status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.run.findMany({
      where: { projectId: pid },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { suite: { select: { name: true } } },
    }),
  ]);
  res.json({ counts: { targets, suites, cases, mcpServers, mcpHealthy, runsActive }, recentRuns });
});
