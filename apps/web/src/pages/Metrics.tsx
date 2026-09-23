import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EVALUATOR_LABELS, type EvaluatorType } from "@aieval/shared";
import { ChartCard, ColumnChart, GroupedHBarChart, HBarChart, Meter, useChartTheme, StatusStackChart, TrendChart, useTargetColors, type SeriesDef } from "../components/charts";
import { Badge, Card, clsx, Loading, PageHeader, Select, Stat, Table } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { compact, ms, num, pct, shortDate, usd } from "../lib/format";
import type { Metrics, Suite, Target } from "../lib/types";

type TrendMetric = "passRate" | "avgScore" | "avgLatencyMs" | "costUsd";
const TREND_METRICS: Record<TrendMetric, { label: string; fmt: (v: number) => string; domain?: [number, number] }> = {
  passRate: { label: "Pass rate", fmt: (v) => pct(v), domain: [0, 1] },
  avgScore: { label: "Avg score", fmt: (v) => pct(v), domain: [0, 1] },
  avgLatencyMs: { label: "Avg latency", fmt: (v) => ms(v) },
  costUsd: { label: "Cost", fmt: (v) => usd(v) },
};

/** Pivots [{bucket, targetId, metric}] into one row per bucket with a column per target. */
export function buildTrendSeries(trend: Metrics["trend"], metric: TrendMetric, colorOf: (id: string | null) => string) {
  const byBucket = new Map<string, Record<string, unknown>>();
  const series = new Map<string, SeriesDef>();
  for (const t of trend) {
    const key = `t_${t.targetId ?? "deleted"}`;
    if (!series.has(key)) series.set(key, { key, name: t.targetName, color: colorOf(t.targetId) });
    const row = byBucket.get(t.bucket) ?? { bucket: t.bucket };
    row[key] = t[metric];
    byBucket.set(t.bucket, row);
  }
  return { data: [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))), series: [...series.values()] };
}

export function MetricsPage() {
  const { projectId } = useProject();
  const colorOf = useTargetColors(projectId);
  const { series: SERIES } = useChartTheme();
  const [days, setDays] = useState(30);
  const [suiteId, setSuiteId] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("passRate");

  const targets = useQuery({ queryKey: ["targets", projectId], queryFn: () => api.get<Target[]>(p(projectId, "/targets")) });
  const suites = useQuery({ queryKey: ["suites", projectId], queryFn: () => api.get<Suite[]>(p(projectId, "/suites")) });
  const bucket = days <= 2 ? "hour" : days > 120 ? "week" : "day";
  const qs = new URLSearchParams({ days: String(days), bucket, ...(suiteId && { suiteId }), ...(targetIds.length && { targetIds: targetIds.join(",") }) });
  const metrics = useQuery({ queryKey: ["metrics", projectId, days, suiteId, targetIds], queryFn: () => api.get<Metrics>(p(projectId, `/metrics?${qs}`)) });

  const m = metrics.data;
  const trend = useMemo(() => (m ? buildTrendSeries(m.trend, trendMetric, colorOf) : null), [m, trendMetric, colorOf]);
  const xFmt = (v: unknown) => (bucket === "hour" ? new Date(v as string).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : shortDate(v as string));
  const rowH = (n: number, min = 160) => Math.max(min, n * 34 + 50);

  return (
    <>
      <PageHeader title="Metrics" subtitle="Quality, latency, cost and evaluator behaviour across runs." />

      {/* Filters: one row above the charts */}
      <div className="card mb-6 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {[1, 7, 30, 90, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={clsx("px-3 py-1.5 text-sm", days === d ? "bg-accent text-white" : "bg-raised text-ink-2 hover:bg-page")}>
              {d === 1 ? "24h" : d === 365 ? "1y" : `${d}d`}
            </button>
          ))}
        </div>
        <Select value={suiteId} onChange={(e) => setSuiteId(e.target.value)} className="w-56">
          <option value="">All suites</option>
          {suites.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-1.5">
          {targets.data?.map((t) => {
            const on = targetIds.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => setTargetIds(on ? targetIds.filter((x) => x !== t.id) : [...targetIds, t.id])}
                className={clsx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on ? "border-accent bg-accent-soft/50 text-ink" : "border-line bg-raised text-ink-2 hover:bg-page")}
              >
                <span className="size-2 rounded-full" style={{ background: colorOf(t.id) }} />
                {t.name}
              </button>
            );
          })}
          {targetIds.length > 0 && (
            <button onClick={() => setTargetIds([])} className="text-xs text-accent hover:underline">
              Clear
            </button>
          )}
        </div>
      </div>

      {metrics.isLoading || !m ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Pass rate" value={pct(m.kpis.passRate)} sub={`${compact(m.kpis.results)} results`} />
            <Stat label="Avg score" value={pct(m.kpis.avgScore)} sub="weighted evaluator score" />
            <Stat label="Error rate" value={pct(m.kpis.errorRate, 1)} sub="target failed to answer" />
            <Stat label="Latency p50 / p95" value={ms(m.kpis.p50LatencyMs)} sub={`p95 ${ms(m.kpis.p95LatencyMs)}`} />
            <Stat label="Spend" value={usd(m.kpis.totalCostUsd)} sub={`${compact(m.kpis.inputTokens + m.kpis.outputTokens)} tokens`} />
            <Stat label="Needs review" value={m.kpis.needsReview} sub={`${m.kpis.reviewed} reviewed by humans`} />
          </div>

          <ChartCard
            title={`${TREND_METRICS[trendMetric].label} over time`}
            subtitle="Per target, one line each"
            height={280}
            empty={!trend?.data.length}
            table={trend ? { columns: ["Period", ...trend.series.map((s) => s.name)], rows: trend.data.map((d) => [xFmt(d.bucket), ...trend.series.map((s) => (d[s.key] === undefined || d[s.key] === null ? "—" : TREND_METRICS[trendMetric].fmt(d[s.key] as number)))]) } : undefined}
          >
            <div className="flex h-full flex-col">
              <div className="mb-1 flex gap-1 px-2">
                {(Object.keys(TREND_METRICS) as TrendMetric[]).map((k) => (
                  <button key={k} onClick={() => setTrendMetric(k)} className={clsx("rounded-md px-2 py-0.5 text-xs", trendMetric === k ? "bg-ink/5 font-medium text-ink" : "text-ink-2 hover:bg-ink/5")}>
                    {TREND_METRICS[k].label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1">{trend && <TrendChart data={trend.data} series={trend.series} xKey="bucket" fmt={TREND_METRICS[trendMetric].fmt} yDomain={TREND_METRICS[trendMetric].domain} xFmt={xFmt} />}</div>
            </div>
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Outcomes by target"
              subtitle="Count of pass, fail and error results"
              height={rowH(m.byTarget.length)}
              empty={!m.byTarget.length}
              table={{ columns: ["Target", "Pass", "Fail", "Error"], rows: m.byTarget.map((t) => [t.targetName, t.passed, t.failed, t.errored]) }}
            >
              <StatusStackChart data={m.byTarget.map((t) => ({ label: t.targetName, PASS: t.passed, FAIL: t.failed, ERROR: t.errored }))} />
            </ChartCard>

            <ChartCard
              title="Latency percentiles"
              subtitle="p50 and p95 per target"
              height={rowH(m.byTarget.length)}
              empty={!m.byTarget.length}
              table={{ columns: ["Target", "p50", "p95", "p99", "avg"], rows: m.byTarget.map((t) => [t.targetName, ms(t.p50LatencyMs), ms(t.p95LatencyMs), ms(t.p99LatencyMs), ms(t.avgLatencyMs)]) }}
            >
              <GroupedHBarChart
                data={m.byTarget.map((t) => ({ label: t.targetName, p50: t.p50LatencyMs, p95: t.p95LatencyMs }))}
                series={[
                  { key: "p50", name: "p50", color: SERIES[0] },
                  { key: "p95", name: "p95", color: SERIES[1] },
                ]}
                fmt={(v) => ms(v)}
              />
            </ChartCard>

            <ChartCard
              title="Spend by target"
              subtitle="Total cost in the window"
              height={rowH(m.byTarget.length)}
              empty={!m.byTarget.some((t) => t.totalCostUsd > 0)}
              table={{ columns: ["Target", "Total", "Per result", "Input tokens", "Output tokens"], rows: m.byTarget.map((t) => [t.targetName, usd(t.totalCostUsd), usd(t.avgCostUsd), compact(t.inputTokens), compact(t.outputTokens)]) }}
            >
              <HBarChart data={m.byTarget.map((t) => ({ label: t.targetName, value: t.totalCostUsd, color: colorOf(t.targetId) }))} fmt={(v) => usd(v)} />
            </ChartCard>

            <ChartCard
              title="Score distribution"
              subtitle="Weighted evaluator score per result"
              height={220}
              empty={!m.scoreHistogram.some((b) => b.count)}
              table={{ columns: ["Score", "Results"], rows: m.scoreHistogram.map((b) => [b.label, b.count]) }}
            >
              <ColumnChart data={m.scoreHistogram} xKey="label" yKey="count" name="Results" fmt={(v) => String(Math.round(v))} />
            </ChartCard>

            <ChartCard
              title="Evaluator pass rates"
              subtitle="Share of results each evaluator passed"
              height={rowH(Math.min(m.evaluators.length, 14))}
              empty={!m.evaluators.length}
              table={{
                columns: ["Evaluator", "Type", "Checks", "Pass rate", "Avg score", "Jev confidence", "Review", "Errors"],
                rows: m.evaluators.map((e) => [e.name, EVALUATOR_LABELS[e.type as EvaluatorType]?.label ?? e.type, e.count, pct(e.passRate), pct(e.avgScore), e.avgConfidence === null ? "—" : num(e.avgConfidence), e.needsReview, e.errors]),
              }}
            >
              <HBarChart data={m.evaluators.slice(0, 14).map((e) => ({ label: e.name, value: e.passRate }))} fmt={(v) => pct(v)} max={1} labelWidth={140} />
            </ChartCard>

            <ChartCard
              title="Pass rate by tag"
              subtitle="Test case tags"
              height={rowH(Math.min(m.tags.length, 14))}
              empty={!m.tags.length}
              table={{ columns: ["Tag", "Results", "Pass rate", "Avg score"], rows: m.tags.map((t) => [t.tag, t.results, pct(t.passRate), pct(t.avgScore)]) }}
            >
              <HBarChart data={m.tags.slice(0, 14).map((t) => ({ label: t.tag, value: t.passRate }))} fmt={(v) => pct(v)} max={1} />
            </ChartCard>

            <ChartCard
              title="Run history"
              subtitle="Pass rate of each completed run"
              height={220}
              empty={!m.runs.length}
              table={{ columns: ["Run", "Suite", "Date", "Cases", "Pass rate", "Cost"], rows: m.runs.map((r) => [<Link key={r.id} className="text-accent hover:underline" to={`/p/${projectId}/runs/${r.id}`}>{r.name || r.id.slice(-6)}</Link>, r.suiteName, shortDate(r.createdAt), r.total, pct(r.passRate), usd(r.totalCostUsd)]) }}
            >
              <TrendChart data={m.runs.map((r, i) => ({ ...r, idx: `#${i + 1}` }))} series={[{ key: "passRate", name: "Pass rate", color: SERIES[0] }]} xKey="idx" fmt={(v) => pct(v)} yDomain={[0, 1]} />
            </ChartCard>

            <ChartCard
              title="MCP tool usage"
              subtitle="Tool calls made by targets"
              height={rowH(Math.min(m.toolUsage.length, 12))}
              empty={!m.toolUsage.length}
              table={{ columns: ["Tool", "Calls", "Errors", "Avg latency"], rows: m.toolUsage.map((t) => [t.tool, t.calls, t.errors, ms(t.avgLatencyMs)]) }}
            >
              <HBarChart data={m.toolUsage.slice(0, 12).map((t) => ({ label: t.tool, value: t.calls }))} fmt={(v) => String(Math.round(v))} labelWidth={160} />
            </ChartCard>
          </div>

          <Card title="Target leaderboard" bodyClassName="p-0">
            <Table>
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Results</th>
                  <th className="w-48">Pass rate</th>
                  <th>Avg score</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>Cost / result</th>
                  <th>Needs review</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...m.byTarget]
                  .sort((a, b) => b.passed / (b.results || 1) - a.passed / (a.results || 1))
                  .map((t) => {
                    const rate = t.results ? t.passed / t.results : null;
                    return (
                      <tr key={t.targetId ?? t.targetName}>
                        <td>
                          <span className="flex items-center gap-2 font-medium">
                            <span className="size-2 rounded-full" style={{ background: colorOf(t.targetId) }} />
                            {t.targetId ? (
                              <Link className="hover:text-accent" to={`/p/${projectId}/targets/${t.targetId}`}>
                                {t.targetName}
                              </Link>
                            ) : (
                              <span>
                                {t.targetName} <Badge>deleted</Badge>
                              </span>
                            )}
                          </span>
                        </td>
                        <td>{t.results}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Meter value={rate} className="w-24" />
                            <span>{pct(rate)}</span>
                          </div>
                        </td>
                        <td>{pct(t.avgScore)}</td>
                        <td>{ms(t.p50LatencyMs)}</td>
                        <td>{ms(t.p95LatencyMs)}</td>
                        <td>{usd(t.avgCostUsd)}</td>
                        <td>{t.needsReview}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
