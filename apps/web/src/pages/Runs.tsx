import { useQuery } from "@tanstack/react-query";
import { GitCompare, PlayCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Meter } from "../components/charts";
import { Button, EmptyState, Loading, PageHeader, Select, StatusBadge, Table } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago, duration, ms, pct, usd } from "../lib/format";
import type { RunSummary, Suite } from "../lib/types";

export function RunsPage() {
  const { projectId } = useProject();
  const navigate = useNavigate();
  const [suiteId, setSuiteId] = useState("");
  const [status, setStatus] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const suites = useQuery({ queryKey: ["suites", projectId], queryFn: () => api.get<Suite[]>(p(projectId, "/suites")) });
  const runs = useQuery({
    queryKey: ["runs", projectId, suiteId, status],
    queryFn: () => api.get<{ runs: RunSummary[] }>(p(projectId, `/runs?limit=100${suiteId ? `&suiteId=${suiteId}` : ""}${status ? `&status=${status}` : ""}`)),
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED") ? 3000 : false),
  });

  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x.slice(-1), id]));

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every execution of a suite against its targets."
        actions={
          <Button icon={<GitCompare className="size-4" />} disabled={picked.length !== 2} onClick={() => navigate(`/p/${projectId}/runs/compare?base=${picked[0]}&head=${picked[1]}`)}>
            Compare selected ({picked.length}/2)
          </Button>
        }
      />
      <div className="mb-4 flex gap-3">
        <Select className="w-60" value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
          <option value="">All suites</option>
          {suites.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      {runs.isLoading ? (
        <Loading />
      ) : !runs.data?.runs.length ? (
        <EmptyState icon={<PlayCircle className="size-8" />} title="No runs yet" description="Open a test suite and press Run." />
      ) : (
        <div className="card">
          <Table>
            <thead>
              <tr>
                <th className="w-8" />
                <th>Run</th>
                <th>Status</th>
                <th className="w-44">Pass rate</th>
                <th>Avg score</th>
                <th>Avg latency</th>
                <th>Cost</th>
                <th>Duration</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {runs.data.runs.map((r) => {
                const rate = r.total ? r.passed / r.total : null;
                return (
                  <tr key={r.id} className="hover:bg-page">
                    <td>
                      <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} title="Select to compare" />
                    </td>
                    <td>
                      <Link className="font-medium hover:text-accent" to={`/p/${projectId}/runs/${r.id}`}>
                        {r.name || r.suite?.name}
                      </Link>
                      <div className="max-w-xs truncate text-xs text-muted">
                        {r.name ? `${r.suite?.name} · ` : ""}
                        {Object.values(r.targetsSnapshot).map((t) => t.name).join(", ")}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Meter value={r.status === "RUNNING" ? r.completed / (r.total || 1) : rate} className="w-16" />
                        <span className="text-xs">
                          {r.status === "RUNNING" ? `${r.completed}/${r.total}` : `${pct(rate)} (${r.passed}/${r.total})`}
                        </span>
                      </div>
                    </td>
                    <td className="text-xs">{pct(r.avgScore)}</td>
                    <td className="text-xs">{ms(r.avgLatencyMs)}</td>
                    <td className="text-xs">{usd(r.totalCostUsd)}</td>
                    <td className="text-xs">{duration(r.startedAt, r.finishedAt)}</td>
                    <td className="text-xs text-muted">
                      {ago(r.createdAt)}
                      {r.triggeredVia === "api" && " · CI"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
