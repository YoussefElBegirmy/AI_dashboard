import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router-dom";
import { ChartCard, TrendChart, useTargetColors } from "../components/charts";
import { Card, Loading, PageHeader, Stat, StatusBadge, Table } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago, ms, pct, shortDate, usd } from "../lib/format";
import type { Metrics, RunSummary } from "../lib/types";
import { buildTrendSeries } from "./Metrics";

export function OverviewPage() {
  const { projectId, project } = useProject();
  const colorOf = useTargetColors(projectId);
  const overview = useQuery({
    queryKey: ["overview", projectId],
    queryFn: () => api.get<{ counts: Record<string, number>; recentRuns: (RunSummary & { suite: { name: string } })[] }>(p(projectId, "/metrics/overview")),
    refetchInterval: 10_000,
  });
  const metrics = useQuery({ queryKey: ["metrics", projectId, 30, "", []], queryFn: () => api.get<Metrics>(p(projectId, "/metrics?days=30")) });
  const secrets = useQuery({ queryKey: ["secrets", projectId], queryFn: () => api.get<{ secrets: { name: string }[]; envFallbacks: string[] }>(p(projectId, "/secrets")) });

  if (overview.isLoading) return <Loading />;
  const c = overview.data?.counts ?? {};
  const k = metrics.data?.kpis;
  const secretNames = new Set([...(secrets.data?.secrets.map((s) => s.name) ?? []), ...(secrets.data?.envFallbacks ?? [])]);
  const steps = [
    { done: secretNames.has("OPENROUTER_API_KEY"), label: "Add your OpenRouter key", to: "settings", hint: "Settings → Secrets → OPENROUTER_API_KEY" },
    { done: secretNames.has("TYPESAFE_API_KEY"), label: "Add your TypeSafe key for Jev", to: "settings", hint: "Settings → Secrets → TYPESAFE_API_KEY" },
    { done: (c.targets ?? 0) > 0, label: "Create a target", to: "targets/new", hint: "An OpenRouter model, HTTP endpoint, workflow or MCP tool" },
    { done: (c.suites ?? 0) > 0 && (c.cases ?? 0) > 0, label: "Build a test suite", to: "suites", hint: "Cases + evaluators (Jev, LLM judge, assertions)" },
    { done: (overview.data?.recentRuns.length ?? 0) > 0, label: "Run it", to: "suites", hint: "Watch results stream in live" },
  ];
  const trend = metrics.data ? buildTrendSeries(metrics.data.trend, "passRate", colorOf) : null;

  return (
    <>
      <PageHeader title={project?.name ?? "Overview"} subtitle="Last 30 days across all suites and targets." />

      {steps.some((s) => !s.done) && (
        <Card title="Get started" className="mb-6">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((s, i) => (
              <li key={i}>
                <Link to={`/p/${projectId}/${s.to}`} className="flex h-full gap-2 rounded-lg border border-line p-3 hover:bg-page">
                  {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" />}
                  <span>
                    <span className={s.done ? "text-sm text-muted line-through" : "text-sm font-medium"}>{s.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{s.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card px-5 py-4 sm:col-span-2 lg:col-span-1 lg:row-span-2">
          <div className="text-xs text-ink-2">Pass rate · 30 days</div>
          <div className="mt-2 text-5xl font-semibold tracking-tight">{pct(k?.passRate)}</div>
          <div className="mt-2 text-xs text-muted">
            {k?.results ?? 0} results in {k?.runs ?? 0} runs
          </div>
          <div className="mt-4 space-y-1 text-xs text-ink-2">
            <div className="flex justify-between">
              <span>Avg score</span>
              <span className="tabular font-medium text-ink">{pct(k?.avgScore)}</span>
            </div>
            <div className="flex justify-between">
              <span>Error rate</span>
              <span className="tabular font-medium text-ink">{pct(k?.errorRate)}</span>
            </div>
            <div className="flex justify-between">
              <span>Needs review</span>
              <span className="tabular font-medium text-ink">{k?.needsReview ?? 0}</span>
            </div>
          </div>
        </div>
        <Stat label="Targets" value={c.targets ?? 0} sub="endpoints, models, workflows, tools" />
        <Stat label="Test suites" value={c.suites ?? 0} sub={`${c.cases ?? 0} test cases`} />
        <Stat label="MCP servers" value={c.mcpServers ?? 0} sub={`${c.mcpHealthy ?? 0} connected`} />
        <Stat label="p95 latency" value={ms(k?.p95LatencyMs)} sub={`p50 ${ms(k?.p50LatencyMs)}`} />
        <Stat label="Spend · 30 days" value={usd(k?.totalCostUsd)} sub="OpenRouter usage reported by targets" />
        <Stat label="Active runs" value={c.runsActive ?? 0} sub="queued or running" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <ChartCard
          className="lg:col-span-3"
          title="Pass rate by target"
          subtitle="Daily share of passing results"
          empty={!trend?.data.length}
          table={trend ? { columns: ["Day", ...trend.series.map((s) => s.name)], rows: trend.data.map((d) => [shortDate(d.bucket as string), ...trend.series.map((s) => pct(d[s.key] as number | null))]) } : undefined}
        >
          {trend && <TrendChart data={trend.data} series={trend.series} xKey="bucket" fmt={(v) => pct(v)} yDomain={[0, 1]} xFmt={(v) => shortDate(v as string)} />}
        </ChartCard>

        <Card title="Recent runs" className="lg:col-span-2" bodyClassName="p-0" actions={<Link to={`/p/${projectId}/runs`} className="text-xs text-accent hover:underline">View all</Link>}>
          {overview.data?.recentRuns.length ? (
            <Table>
              <tbody>
                {overview.data.recentRuns.map((r) => (
                  <tr key={r.id} className="hover:bg-page">
                    <td>
                      <Link to={`/p/${projectId}/runs/${r.id}`} className="font-medium hover:text-accent">
                        {r.name || r.suite.name}
                      </Link>
                      <div className="text-xs text-muted">{ago(r.createdAt)}</div>
                    </td>
                    <td className="tabular text-right text-xs text-ink-2">
                      {r.passed}/{r.total}
                    </td>
                    <td className="text-right">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-6 text-center text-sm text-muted">No runs yet</div>
          )}
        </Card>
      </div>
    </>
  );
}
