import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, Eye, GitCompare, RotateCcw, Trash2, UserCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EVALUATOR_LABELS, type EvaluatorType, type RunEvent } from "@aieval/shared";
import { ChartCard, GroupedHBarChart, HBarChart, useChartTheme, useTargetColors } from "../components/charts";
import { CodeView } from "../components/JsonEditor";
import { OutputView } from "../components/OutputView";
import { Badge, Button, Card, clsx, Confirm, Drawer, ErrorBox, Field, Loading, PageHeader, Select, Stat, StatusBadge, Textarea } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { dateTime, duration, ms, num, pct, usd } from "../lib/format";
import type { EvaluationRow, RunDetail, RunResult, RunSummary } from "../lib/types";

const effective = (r: RunResult) => r.humanStatus ?? r.status;

function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function ProbBars({ probs, highlight, labels }: { probs: Record<string, number>; highlight?: string; labels?: Record<string, string> }) {
  const entries = Object.entries(probs);
  return (
    <div className="mt-2 space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-2 text-xs">
          <span className={clsx("truncate", k === highlight ? "font-medium text-ink" : "text-ink-2")} title={labels?.[k] ?? k}>
            {labels?.[k] ? `${k} · ${labels[k]}` : k}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-accent-soft">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} />
          </div>
          <span className="tabular text-right text-ink-2">{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

function EvaluationCard({ e }: { e: EvaluationRow }) {
  const meta = EVALUATOR_LABELS[e.type as EvaluatorType];
  const answer = (e.details?.answer ?? null) as Record<string, unknown> | null;
  return (
    <div className="rounded-lg border border-line bg-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {e.error ? <AlertTriangle className="size-4 shrink-0 text-warning" /> : e.pass ? <CheckCircle2 className="size-4 shrink-0 text-good" /> : <XCircle className="size-4 shrink-0 text-critical" />}
          <span className="truncate text-sm font-medium">{e.name}</span>
          <Badge tone={meta?.family === "Jev" ? "accent" : "neutral"}>{meta?.label ?? e.type}</Badge>
          {!e.required && <span className="text-xs text-muted">informational</span>}
          {e.needsReview && (
            <Badge tone="warn">
              <Eye className="size-3" /> review
            </Badge>
          )}
        </div>
        <span className="tabular shrink-0 text-xs text-ink-2">
          {e.pass === null ? "—" : e.pass ? "Pass" : "Fail"} · score {pct(e.score)}
        </span>
      </div>
      {e.error && <ErrorBox error={e.error} className="mt-2" />}
      {e.reasoning && <p className="mt-2 text-xs text-ink-2">{e.reasoning}</p>}
      {answer && answer.type === "noul" && <ProbBars probs={{ "P(yes)": Number(answer.noul) }} />}
      {answer && answer.type === "choice" && <ProbBars probs={answer.probabilities as Record<string, number>} highlight={String(answer.choice)} />}
      {answer && answer.type === "score" && (
        <ProbBars probs={answer.probabilities as Record<string, number>} highlight={String(Math.round(Number(answer.score)))} labels={answer.legend as Record<string, string>} />
      )}
      {answer && "confidence" in answer && <div className="mt-1 text-[11px] text-muted">Jev confidence {num(Number(answer.confidence))}</div>}
    </div>
  );
}

function ResultDrawer({ result, onClose, projectId, runId, canEdit }: { result: RunResult; onClose: () => void; projectId: string; runId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(result.reviewNote ?? "");
  const review = useMutation({
    mutationFn: (status: "PASS" | "FAIL" | null) => api.post<RunResult>(p(projectId, `/runs/${runId}/results/${result.id}/review`), { status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run", projectId, runId] }),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <StatusBadge status={effective(result)} />
          <span className="truncate">
            {result.caseName} <span className="text-muted">×</span> {result.targetName}
          </span>
          {result.humanStatus && (
            <Badge tone="accent">
              <UserCheck className="size-3" /> reviewed
            </Badge>
          )}
        </span>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Score" value={pct(result.score)} />
          <Stat label="Latency" value={ms(result.latencyMs)} sub={result.statusCode ? `HTTP ${result.statusCode}` : undefined} />
          <Stat label="Tokens" value={result.inputTokens ? `${result.inputTokens + (result.outputTokens ?? 0)}` : "—"} sub={result.inputTokens ? `${result.inputTokens} in · ${result.outputTokens} out` : undefined} />
          <Stat label="Cost" value={usd(result.costUsd)} />
        </div>
        {result.error && <ErrorBox error={result.error} />}

        {result.evaluations.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Evaluations</h4>
            <div className="space-y-2">
              {result.evaluations.map((e) => (
                <EvaluationCard key={e.id} e={e} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-sm font-semibold">Response</h4>
          <OutputView output={result.output} outputJson={result.outputJson} raw={result.raw} toolCalls={result.toolCalls} trace={result.trace} />
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="label">Input</div>
            <CodeView value={result.input} maxHeight="14rem" />
          </div>
          <div>
            <div className="label">Expected</div>
            <CodeView value={result.expected ?? "—"} maxHeight="14rem" />
          </div>
        </section>

        {canEdit && result.status !== "ERROR" && (
          <Card title="Human review" actions={result.needsReview && !result.humanStatus ? <Badge tone="warn">Jev was uncertain</Badge> : undefined}>
            <Field label="Note (optional)">
              <Textarea className="font-sans text-sm" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={<CheckCircle2 className="size-4 text-good" />} loading={review.isPending && review.variables === "PASS"} onClick={() => review.mutate("PASS")}>
                Mark pass
              </Button>
              <Button icon={<XCircle className="size-4 text-critical" />} loading={review.isPending && review.variables === "FAIL"} onClick={() => review.mutate("FAIL")}>
                Mark fail
              </Button>
              {result.humanStatus && (
                <Button variant="ghost" onClick={() => review.mutate(null)}>
                  Clear override (auto: {result.status.toLowerCase()})
                </Button>
              )}
            </div>
            <ErrorBox error={review.error} className="mt-2" />
          </Card>
        )}
      </div>
    </Drawer>
  );
}

export function RunDetailPage() {
  const { projectId, canEdit } = useProject();
  const { runId = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const colorOf = useTargetColors(projectId);
  const { series: SERIES } = useChartTheme();
  const run = useQuery({ queryKey: ["run", projectId, runId], queryFn: () => api.get<RunDetail>(p(projectId, `/runs/${runId}`)) });
  const [progress, setProgress] = useState<Extract<RunEvent, { type: "progress" }> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "fail" | "error" | "review" | "pass">("all");
  const [deleting, setDeleting] = useState(false);
  const refetchTimer = useRef<number | null>(null);

  const live = run.data && (run.data.status === "RUNNING" || run.data.status === "QUEUED");
  useEffect(() => {
    if (!live) return;
    const es = new EventSource(`/api/projects/${projectId}/runs/${runId}/events`, { withCredentials: true });
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as RunEvent;
      if (ev.type === "progress") setProgress(ev);
      if (ev.type === "result" || ev.type === "status") {
        if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
        refetchTimer.current = window.setTimeout(() => qc.invalidateQueries({ queryKey: ["run", projectId, runId] }), ev.type === "status" ? 0 : 600);
      }
    };
    return () => es.close();
  }, [live, projectId, runId, qc]);

  const cancel = useMutation({ mutationFn: () => api.post(p(projectId, `/runs/${runId}/cancel`)), onSuccess: () => qc.invalidateQueries({ queryKey: ["run", projectId, runId] }) });
  const rerun = useMutation({ mutationFn: () => api.post<RunSummary>(p(projectId, `/runs/${runId}/rerun`)), onSuccess: (r) => navigate(`/p/${projectId}/runs/${r.id}`) });
  const del = useMutation({ mutationFn: () => api.del(p(projectId, `/runs/${runId}`)), onSuccess: () => navigate(`/p/${projectId}/runs`) });
  const previous = useQuery({
    queryKey: ["runs", projectId, run.data?.suiteId, "prev"],
    enabled: Boolean(run.data),
    queryFn: () => api.get<{ runs: RunSummary[] }>(p(projectId, `/runs?suiteId=${run.data!.suiteId}&limit=20`)),
  });

  const data = run.data;
  const derived = useMemo(() => {
    if (!data) return null;
    const results = data.results;
    const cases = [...new Map(results.map((r) => [r.testCaseId ?? r.caseName, r.caseName])).entries()];
    const targets = data.targetIds.map((id) => ({ id, name: data.targetsSnapshot[id]?.name ?? "deleted" }));
    const cell = new Map(results.map((r) => [`${r.testCaseId ?? r.caseName}::${r.targetId}`, r]));
    const done = results.filter((r) => r.status !== "PENDING");
    const perTarget = targets.map((t) => {
      const rs = done.filter((r) => r.targetId === t.id);
      const lat = rs.map((r) => r.latencyMs).filter((x): x is number => x !== null);
      return {
        ...t,
        count: rs.length,
        passRate: rs.length ? rs.filter((r) => effective(r) === "PASS").length / rs.length : null,
        p50: quantile(lat, 0.5),
        p95: quantile(lat, 0.95),
        cost: rs.reduce((s, r) => s + (r.costUsd ?? 0), 0),
        avgScore: rs.filter((r) => r.score !== null).reduce((s, r, _i, arr) => s + (r.score ?? 0) / arr.length, 0),
      };
    });
    const evalMap = new Map<string, { name: string; type: string; n: number; pass: number }>();
    for (const r of done)
      for (const e of r.evaluations) {
        const k = `${e.name}::${e.type}`;
        const v = evalMap.get(k) ?? { name: e.name, type: e.type, n: 0, pass: 0 };
        v.n++;
        if (e.pass) v.pass++;
        evalMap.set(k, v);
      }
    return { cases, targets, cell, perTarget, evaluators: [...evalMap.values()], reviewCount: done.filter((r) => r.needsReview && !r.humanStatus).length };
  }, [data]);

  if (run.isLoading || !data || !derived) return run.error ? <ErrorBox error={run.error} /> : <Loading />;

  const prog = live && progress ? progress : { completed: data.completed, total: data.total, passed: data.passed, failed: data.failed, errored: data.errored };
  const humanPassed = data.results.filter((r) => effective(r) === "PASS").length;
  const matches = (r?: RunResult) => {
    if (!r) return filter === "all";
    if (filter === "all") return true;
    if (filter === "fail") return effective(r) === "FAIL";
    if (filter === "error") return r.status === "ERROR";
    if (filter === "pass") return effective(r) === "PASS";
    return r.needsReview && !r.humanStatus;
  };
  const visibleCases = derived.cases.filter(([key]) => derived.targets.some((t) => matches(derived.cell.get(`${key}::${t.id}`))));
  const open = data.results.find((r) => r.id === openId);
  const prevRun = previous.data?.runs.find((r) => r.id !== data.id && new Date(r.createdAt) < new Date(data.createdAt) && r.status === "COMPLETED");
  const chartH = Math.max(120, derived.targets.length * 36 + 50);

  return (
    <>
      <PageHeader
        back={
          <>
            <Link to={`/p/${projectId}/runs`}>← Runs</Link> · <Link to={`/p/${projectId}/suites/${data.suiteId}`}>{data.suite?.name}</Link>
          </>
        }
        title={
          <span className="flex items-center gap-3">
            {data.name || `Run ${data.id.slice(-6)}`} <StatusBadge status={data.status} />
          </span>
        }
        subtitle={`Started ${dateTime(data.startedAt ?? data.createdAt)} · ${duration(data.startedAt, data.finishedAt)} · concurrency ${data.concurrency}${data.tags.length ? ` · tags: ${data.tags.join(", ")}` : ""}`}
        actions={
          <>
            {prevRun && (
              <Link to={`/p/${projectId}/runs/compare?base=${prevRun.id}&head=${data.id}`}>
                <Button icon={<GitCompare className="size-4" />}>Compare with previous</Button>
              </Link>
            )}
            {canEdit && live && (
              <Button icon={<Ban className="size-4" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel
              </Button>
            )}
            {canEdit && !live && (
              <>
                <Button icon={<RotateCcw className="size-4" />} loading={rerun.isPending} onClick={() => rerun.mutate()}>
                  Re-run
                </Button>
                <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />
              </>
            )}
          </>
        }
      />
      {data.error && <ErrorBox error={data.error} className="mb-4" />}

      <div className="card mb-6 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {prog.completed} / {prog.total} executed
          </span>
          <span className="tabular flex gap-4 text-xs text-ink-2">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-3.5 text-good" /> {live ? prog.passed : humanPassed} pass
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="size-3.5 text-critical" /> {live ? prog.failed : data.results.filter((r) => effective(r) === "FAIL").length} fail
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="size-3.5 text-warning" /> {prog.errored} error
            </span>
            <span className="flex items-center gap-1">
              <Eye className="size-3.5 text-muted" /> {derived.reviewCount} to review
            </span>
          </span>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-page">
          {[
            [live ? prog.passed : humanPassed, "bg-good"],
            [live ? prog.failed : data.results.filter((r) => effective(r) === "FAIL").length, "bg-critical"],
            [prog.errored, "bg-warning"],
          ].map(([n, cls], i) => (
            <div key={i} className={clsx("h-full transition-all", cls as string)} style={{ width: `${((n as number) / (prog.total || 1)) * 100}%` }} />
          ))}
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pass rate" value={pct(data.total ? humanPassed / data.total : null)} sub={`${humanPassed} of ${data.total}`} />
        <Stat label="Avg score" value={pct(data.avgScore)} />
        <Stat label="Avg latency" value={ms(data.avgLatencyMs)} />
        <Stat label="Cost" value={usd(data.totalCostUsd)} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <ChartCard title="Pass rate by target" height={chartH} empty={!derived.perTarget.some((t) => t.count)} table={{ columns: ["Target", "Results", "Pass rate", "Avg score"], rows: derived.perTarget.map((t) => [t.name, t.count, pct(t.passRate), pct(t.avgScore)]) }}>
          <HBarChart data={derived.perTarget.map((t) => ({ label: t.name, value: t.passRate, color: colorOf(t.id) }))} fmt={(v) => pct(v)} max={1} />
        </ChartCard>
        <ChartCard title="Latency by target" subtitle="p50 and p95" height={chartH} empty={!derived.perTarget.some((t) => t.p50 !== null)} table={{ columns: ["Target", "p50", "p95", "Cost"], rows: derived.perTarget.map((t) => [t.name, ms(t.p50), ms(t.p95), usd(t.cost)]) }}>
          <GroupedHBarChart
            data={derived.perTarget.map((t) => ({ label: t.name, p50: t.p50, p95: t.p95 }))}
            series={[
              { key: "p50", name: "p50", color: SERIES[0] },
              { key: "p95", name: "p95", color: SERIES[1] },
            ]}
            fmt={(v) => ms(v)}
          />
        </ChartCard>
        <ChartCard
          title="Evaluator pass rates"
          height={Math.max(120, derived.evaluators.length * 34 + 50)}
          empty={!derived.evaluators.length}
          table={{ columns: ["Evaluator", "Checks", "Passed", "Pass rate"], rows: derived.evaluators.map((e) => [e.name, e.n, e.pass, pct(e.pass / e.n)]) }}
        >
          <HBarChart data={derived.evaluators.map((e) => ({ label: e.name, value: e.pass / e.n }))} fmt={(v) => pct(v)} max={1} />
        </ChartCard>
      </div>

      <Card
        title="Results"
        bodyClassName="p-0"
        actions={
          <Select className="h-8 w-44 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All results</option>
            <option value="fail">Failures</option>
            <option value="error">Errors</option>
            <option value="review">Needs review</option>
            <option value="pass">Passing</option>
          </Select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="sticky left-0 bg-surface px-4 py-2 font-medium">Test case</th>
                {derived.targets.map((t) => (
                  <th key={t.id} className="min-w-44 px-3 py-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: colorOf(t.id) }} />
                      {t.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCases.map(([key, name]) => (
                <tr key={key} className="border-b border-line last:border-0">
                  <td className="sticky left-0 max-w-xs truncate bg-surface px-4 py-2 font-medium">{name}</td>
                  {derived.targets.map((t) => {
                    const r = derived.cell.get(`${key}::${t.id}`);
                    if (!r) return <td key={t.id} className="px-3 py-2 text-xs text-muted">—</td>;
                    return (
                      <td key={t.id} className="px-3 py-1.5">
                        <button onClick={() => setOpenId(r.id)} className={clsx("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-page", !matches(r) && "opacity-30")}>
                          <span className="flex items-center gap-1.5">
                            <StatusBadge status={effective(r)} />
                            {r.needsReview && !r.humanStatus && <Eye className="size-3.5 text-muted" aria-label="needs review" />}
                            {r.humanStatus && <UserCheck className="size-3.5 text-accent" aria-label="reviewed" />}
                          </span>
                          <span className="tabular text-xs text-ink-2">
                            {r.score !== null ? pct(r.score) : ""} {r.latencyMs !== null ? `· ${ms(r.latencyMs)}` : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!visibleCases.length && (
                <tr>
                  <td colSpan={derived.targets.length + 1} className="px-4 py-8 text-center text-sm text-muted">
                    {data.status === "QUEUED" ? "Waiting to start…" : "No results match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {open && <ResultDrawer key={open.id} result={open} onClose={() => setOpenId(null)} projectId={projectId} runId={runId} canEdit={canEdit} />}
      <Confirm open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete run" message="Delete this run and all its results?" />
    </>
  );
}
