import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, clsx, ErrorBox, Loading, PageHeader, Select, Stat, StatusBadge, Table } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { dateTime, ms, pct, usd } from "../lib/format";
import type { RunSummary } from "../lib/types";

interface CompareRow {
  key: string;
  caseName: string;
  targetName: string;
  change: "regressed" | "fixed" | "worse" | "better" | "same" | "changed" | "new" | "removed";
  base: { status: string; humanStatus: string | null; score: number | null; latencyMs: number | null; costUsd: number | null; output: string | null } | null;
  head: { status: string; humanStatus: string | null; score: number | null; latencyMs: number | null; costUsd: number | null; output: string | null } | null;
}
interface CompareData {
  base: RunSummary;
  head: RunSummary;
  summary: Record<CompareRow["change"], number>;
  rows: CompareRow[];
}

const CHANGE: Record<CompareRow["change"], { label: string; tone: "good" | "bad" | "neutral" | "warn" | "accent" }> = {
  regressed: { label: "Regressed", tone: "bad" },
  fixed: { label: "Fixed", tone: "good" },
  worse: { label: "Score ↓", tone: "warn" },
  better: { label: "Score ↑", tone: "good" },
  changed: { label: "Changed", tone: "warn" },
  same: { label: "Same", tone: "neutral" },
  new: { label: "New", tone: "accent" },
  removed: { label: "Removed", tone: "neutral" },
};

export function RunComparePage() {
  const { projectId } = useProject();
  const [params] = useSearchParams();
  const base = params.get("base") ?? "";
  const head = params.get("head") ?? "";
  const [filter, setFilter] = useState<"changes" | "all">("changes");
  const q = useQuery({ queryKey: ["compare", projectId, base, head], enabled: Boolean(base && head), queryFn: () => api.get<CompareData>(p(projectId, `/runs/compare?base=${base}&head=${head}`)) });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Pick two runs to compare"} />;
  const d = q.data;
  const rows = d.rows
    .filter((r) => filter === "all" || r.change !== "same")
    .sort((a, b) => ["regressed", "worse", "changed", "fixed", "better", "new", "removed", "same"].indexOf(a.change) - ["regressed", "worse", "changed", "fixed", "better", "new", "removed", "same"].indexOf(b.change));
  const rate = (r: RunSummary) => (r.total ? r.passed / r.total : null);
  const delta = (a: number | null, b: number | null) => (a === null || b === null ? "" : `${b - a >= 0 ? "+" : ""}${((b - a) * 100).toFixed(1)} pts`);

  return (
    <>
      <PageHeader back={<Link to={`/p/${projectId}/runs`}>← Runs</Link>} title="Compare runs" subtitle="Base → head, matched by test case and target." />
      <div className="mb-6 grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
        {[d.base, d.head].map((r, i) => (
          <div key={r.id} className={clsx("card p-4", i === 1 && "md:order-3")}>
            <div className="text-xs text-muted">{i === 0 ? "Base" : "Head"}</div>
            <Link to={`/p/${projectId}/runs/${r.id}`} className="font-medium hover:text-accent">
              {r.name || `Run ${r.id.slice(-6)}`}
            </Link>
            <div className="mt-1 text-xs text-ink-2">
              {dateTime(r.createdAt)} · {pct(rate(r))} pass · {usd(r.totalCostUsd)}
            </div>
          </div>
        ))}
        <ArrowRight className="mx-auto size-5 text-muted md:order-2" />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Pass rate" value={pct(rate(d.head))} sub={delta(rate(d.base), rate(d.head))} />
        <Stat label="Avg score" value={pct(d.head.avgScore)} sub={delta(d.base.avgScore, d.head.avgScore)} />
        <Stat label="Regressions" value={d.summary.regressed} sub={`${d.summary.worse} lower scores`} />
        <Stat label="Fixed" value={d.summary.fixed} sub={`${d.summary.better} higher scores`} />
        <Stat label="Avg latency" value={ms(d.head.avgLatencyMs)} sub={`base ${ms(d.base.avgLatencyMs)}`} />
      </div>
      <div className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">Per case</h3>
          <Select className="h-8 w-40 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="changes">Changes only</option>
            <option value="all">All rows</option>
          </Select>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Change</th>
              <th>Test case</th>
              <th>Target</th>
              <th>Base</th>
              <th>Head</th>
              <th>Score</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <Badge tone={CHANGE[r.change].tone}>{CHANGE[r.change].label}</Badge>
                </td>
                <td className="font-medium">{r.caseName}</td>
                <td className="text-xs text-ink-2">{r.targetName}</td>
                <td>{r.base ? <StatusBadge status={r.base.humanStatus ?? r.base.status} /> : "—"}</td>
                <td>{r.head ? <StatusBadge status={r.head.humanStatus ?? r.head.status} /> : "—"}</td>
                <td className="text-xs">
                  {pct(r.base?.score)} → {pct(r.head?.score)}
                </td>
                <td className="text-xs">
                  {ms(r.base?.latencyMs)} → {ms(r.head?.latencyMs)}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted">
                  No differences.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    </>
  );
}
