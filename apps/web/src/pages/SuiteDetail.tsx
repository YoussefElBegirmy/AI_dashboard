import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Copy, Download, Pencil, Play, Plus, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TARGET_KIND_LABELS, type Evaluator, type SuiteSettings } from "@aieval/shared";
import { useTargetColors } from "../components/charts";
import { EvaluatorBuilder } from "../components/EvaluatorBuilder";
import { JsonEditor } from "../components/JsonEditor";
import { Badge, Button, Card, clsx, Confirm, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Tabs, Textarea, Toggle } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago, duration, pct } from "../lib/format";
import type { RunSummary, Suite, Target, TestCase } from "../lib/types";

type Tab = "cases" | "evaluators" | "settings" | "runs";

interface CaseDraft {
  id?: string;
  name: string;
  input: unknown;
  expected: unknown;
  tags: string[];
  evaluators: Evaluator[];
  useSuiteEvaluators: boolean;
  enabled: boolean;
}

const newCase = (): CaseDraft => ({ name: "", input: { prompt: "" }, expected: null, tags: [], evaluators: [], useSuiteEvaluators: true, enabled: true });

const preview = (v: unknown) => {
  if (v === null || v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
};

function CaseEditor({ draft, onClose, projectId, suiteId }: { draft: CaseDraft; onClose: () => void; projectId: string; suiteId: string }) {
  const qc = useQueryClient();
  const [c, setC] = useState(draft);
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...c, tags: tagText.split(",").map((t) => t.trim()).filter(Boolean) };
      return c.id ? api.put(p(projectId, `/suites/${suiteId}/cases/${c.id}`), body) : api.post(p(projectId, `/suites/${suiteId}/cases`), body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suite", projectId, suiteId] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={c.id ? "Edit test case" : "New test case"}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!c.name.trim()} onClick={() => save.mutate()}>
            Save case
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
          <Field label="Name">
            <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="smoke, billing" />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Input" hint="Available to targets as {{input.…}}">
            <JsonEditor value={c.input} onChange={(input) => setC({ ...c, input })} height="180px" />
          </Field>
          <Field label="Expected (optional)" hint="Reference for evaluators, as {{expected.…}}">
            <JsonEditor value={c.expected} onChange={(expected) => setC({ ...c, expected })} height="180px" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Toggle checked={c.enabled} onChange={(enabled) => setC({ ...c, enabled })} label="Enabled" />
          <Toggle checked={c.useSuiteEvaluators} onChange={(useSuiteEvaluators) => setC({ ...c, useSuiteEvaluators })} label="Use suite evaluators" />
        </div>
        <Field label="Extra evaluators for this case">
          <EvaluatorBuilder value={c.evaluators} onChange={(evaluators) => setC({ ...c, evaluators })} />
        </Field>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}

/** CSV columns: name, input (JSON) or input.<field>, expected (JSON) or expected.<field>, tags. JSONL/JSON: case objects. */
function parseImport(text: string, format: "csv" | "jsonl" | "json"): { cases: CaseDraft[]; error?: string } {
  try {
    if (format === "json") {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error("Expected a JSON array of cases");
      return { cases: arr.map(normalizeCase) };
    }
    if (format === "jsonl") {
      return { cases: text.split(/\r?\n/).filter((l) => l.trim()).map((l) => normalizeCase(JSON.parse(l))) };
    }
    const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    return {
      cases: parsed.data.map((row, i) => {
        const input: Record<string, unknown> = {};
        const expected: Record<string, unknown> = {};
        let inputRaw: unknown;
        let expectedRaw: unknown;
        for (const [k, v] of Object.entries(row)) {
          if (k === "input") inputRaw = tryJson(v);
          else if (k === "expected") expectedRaw = tryJson(v);
          else if (k.startsWith("input.")) input[k.slice(6)] = v;
          else if (k.startsWith("expected.")) expected[k.slice(9)] = v;
        }
        return {
          ...newCase(),
          name: row.name || `Case ${i + 1}`,
          input: inputRaw ?? input,
          expected: expectedRaw ?? (Object.keys(expected).length ? expected : null),
          tags: (row.tags ?? "").split(/[;,]/).map((t) => t.trim()).filter(Boolean),
        };
      }),
    };
  } catch (e) {
    return { cases: [], error: (e as Error).message };
  }
}

function tryJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function normalizeCase(o: Record<string, unknown>, i = 0): CaseDraft {
  return {
    ...newCase(),
    name: String(o.name ?? `Case ${i + 1}`),
    input: o.input ?? {},
    expected: o.expected ?? null,
    tags: Array.isArray(o.tags) ? (o.tags as string[]) : [],
    evaluators: Array.isArray(o.evaluators) ? (o.evaluators as Evaluator[]) : [],
    useSuiteEvaluators: o.useSuiteEvaluators !== false,
    enabled: o.enabled !== false,
  };
}

function ImportDialog({ onClose, projectId, suiteId }: { onClose: () => void; projectId: string; suiteId: string }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<"csv" | "jsonl" | "json">("csv");
  const [text, setText] = useState("name,input.question,expected.answer,tags\nFrance,What is the capital of France?,Paris,geo\n");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const parsed = useMemo(() => parseImport(text, format), [text, format]);
  const run = useMutation({
    mutationFn: () => api.post<{ imported: number }>(p(projectId, `/suites/${suiteId}/cases/import`), { mode, cases: parsed.cases }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suite", projectId, suiteId] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Import test cases"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} disabled={!parsed.cases.length} onClick={() => run.mutate()}>
            Import {parsed.cases.length} case{parsed.cases.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-40" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
            <option value="csv">CSV</option>
            <option value="jsonl">JSONL</option>
            <option value="json">JSON array</option>
          </Select>
          <Select className="w-52" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="append">Append to existing</option>
            <option value="replace">Replace all cases</option>
          </Select>
          <label className="cursor-pointer text-sm text-accent hover:underline">
            Load file…
            <input
              type="file"
              accept=".csv,.jsonl,.json,.txt"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setText(await f.text());
                setFormat(f.name.endsWith(".jsonl") ? "jsonl" : f.name.endsWith(".json") ? "json" : "csv");
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          {format === "csv" ? (
            <>
              Columns: <code className="code">name</code>, <code className="code">input.&lt;field&gt;</code> or <code className="code">input</code> (JSON), <code className="code">expected.&lt;field&gt;</code> or{" "}
              <code className="code">expected</code>, <code className="code">tags</code> (comma/semicolon).
            </>
          ) : (
            <>
              Objects like <code className="code">{'{"name": "...", "input": {...}, "expected": {...}, "tags": []}'}</code>
            </>
          )}
        </p>
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        {parsed.error ? <ErrorBox error={parsed.error} /> : <p className="text-xs text-ink-2">{parsed.cases.length} cases parsed.</p>}
        <ErrorBox error={run.error} />
      </div>
    </Modal>
  );
}

function RunDialog({ suite, onClose, projectId }: { suite: Suite; onClose: () => void; projectId: string }) {
  const navigate = useNavigate();
  const colorOf = useTargetColors(projectId);
  const targets = useQuery({ queryKey: ["targets", projectId], queryFn: () => api.get<Target[]>(p(projectId, "/targets")) });
  const [selected, setSelected] = useState<string[]>(suite.defaultTargetIds);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState(suite.settings.concurrency ?? 4);
  const allTags = [...new Set(suite.cases?.flatMap((c) => c.tags) ?? [])];
  const enabled = suite.cases?.filter((c) => c.enabled && (!tags.length || c.tags.some((t) => tags.includes(t)))).length ?? 0;
  const start = useMutation({
    mutationFn: () => api.post<RunSummary>(p(projectId, `/suites/${suite.id}/runs`), { targetIds: selected, name: name || undefined, tags, concurrency }),
    onSuccess: (r) => navigate(`/p/${projectId}/runs/${r.id}`),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Run “${suite.name}”`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Play className="size-4" />} loading={start.isPending} disabled={!selected.length || !enabled} onClick={() => start.mutate()}>
            Start run · {enabled * selected.length} executions
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Targets" hint="Pick several to compare them side by side.">
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
            {targets.data?.map((t) => {
              const on = selected.includes(t.id);
              return (
                <label key={t.id} className={clsx("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-page", on && "bg-accent-soft/40")}>
                  <input type="checkbox" checked={on} onChange={() => setSelected(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])} />
                  <span className="size-2 rounded-full" style={{ background: colorOf(t.id) }} />
                  <span className="text-sm">{t.name}</span>
                  <span className="text-xs text-muted">{TARGET_KIND_LABELS[t.kind]}</span>
                </label>
              );
            })}
            {!targets.data?.length && (
              <p className="p-2 text-sm text-muted">
                No targets.{" "}
                <Link className="text-accent" to={`/p/${projectId}/targets/new`}>
                  Create one
                </Link>
              </p>
            )}
          </div>
        </Field>
        {allTags.length > 0 && (
          <Field label="Only cases tagged (optional)">
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) => {
                const on = tags.includes(t);
                return (
                  <button key={t} onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])} className={clsx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-accent bg-accent-soft/50" : "border-line bg-raised text-ink-2")}>
                    {t}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Run name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. prompt v2" />
          </Field>
          <Field label="Concurrency">
            <Input type="number" min={1} max={32} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
          </Field>
        </div>
        <ErrorBox error={start.error} />
      </div>
    </Modal>
  );
}

export function SuiteDetailPage() {
  const { projectId, canEdit } = useProject();
  const { suiteId = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const suite = useQuery({ queryKey: ["suite", projectId, suiteId], queryFn: () => api.get<Suite>(p(projectId, `/suites/${suiteId}`)) });
  const runs = useQuery({ queryKey: ["runs", projectId, suiteId], queryFn: () => api.get<{ runs: RunSummary[] }>(p(projectId, `/runs?suiteId=${suiteId}&limit=50`)) });
  const targets = useQuery({ queryKey: ["targets", projectId], queryFn: () => api.get<Target[]>(p(projectId, "/targets")) });
  const [tab, setTab] = useState<Tab>("cases");
  const [editing, setEditing] = useState<CaseDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState("");
  const [meta, setMeta] = useState<{ name: string; description: string; evaluators: Evaluator[]; settings: SuiteSettings; defaultTargetIds: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (suite.data && !dirty) {
      setMeta({ name: suite.data.name, description: suite.data.description, evaluators: suite.data.evaluators, settings: suite.data.settings, defaultTargetIds: suite.data.defaultTargetIds });
    }
  }, [suite.data, dirty]);

  const saveMeta = useMutation({
    mutationFn: () => api.put(p(projectId, `/suites/${suiteId}`), meta),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["suite", projectId, suiteId] });
      qc.invalidateQueries({ queryKey: ["suites", projectId] });
    },
  });
  const delCase = useMutation({
    mutationFn: (id: string) => api.del(p(projectId, `/suites/${suiteId}/cases/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suite", projectId, suiteId] }),
  });
  const toggleCase = useMutation({
    mutationFn: (c: TestCase) => api.put(p(projectId, `/suites/${suiteId}/cases/${c.id}`), { ...c, enabled: !c.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suite", projectId, suiteId] }),
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<Suite>(p(projectId, `/suites/${suiteId}/duplicate`)),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["suites", projectId] });
      navigate(`/p/${projectId}/suites/${s.id}`);
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(p(projectId, `/suites/${suiteId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suites", projectId] });
      navigate(`/p/${projectId}/suites`);
    },
  });

  const exportCases = async () => {
    const data = await api.get<unknown[]>(p(projectId, `/suites/${suiteId}/cases/export`));
    const blob = new Blob([data.map((d) => JSON.stringify(d)).join("\n")], { type: "application/x-ndjson" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${suite.data?.name ?? "suite"}.jsonl`;
    a.click();
  };

  if (suite.isLoading || !meta) return suite.error ? <ErrorBox error={suite.error} /> : <Loading />;
  const s = suite.data!;
  const cases = (s.cases ?? []).filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()) || c.tags.some((t) => t.includes(filter)));
  const setM = (patch: Partial<typeof meta>) => {
    setMeta({ ...meta, ...patch });
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        back={<Link to={`/p/${projectId}/suites`}>← Test suites</Link>}
        title={s.name}
        subtitle={s.description || `${s.cases?.length ?? 0} cases · ${s.evaluators.length} evaluators`}
        actions={
          <>
            {canEdit && (
              <>
                <Button icon={<Copy className="size-4" />} onClick={() => duplicate.mutate()} loading={duplicate.isPending}>
                  Duplicate
                </Button>
                <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />
              </>
            )}
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => setRunning(true)} disabled={!canEdit || !s.cases?.length}>
              Run suite
            </Button>
          </>
        }
      />

      <Tabs
        tabs={[
          { id: "cases", label: `Test cases (${s.cases?.length ?? 0})` },
          { id: "evaluators", label: `Evaluators (${meta.evaluators.length})` },
          { id: "settings", label: "Settings" },
          { id: "runs", label: `Runs (${runs.data?.runs.length ?? 0})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {dirty && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft/30 px-4 py-2 text-sm">
          <span>You have unsaved suite changes.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setDirty(false)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} loading={saveMeta.isPending} onClick={() => saveMeta.mutate()}>
              Save
            </Button>
          </div>
        </div>
      )}
      <ErrorBox error={saveMeta.error} className="mb-4" />

      {tab === "cases" && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Input placeholder="Filter by name or tag…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
            <div className="flex gap-2">
              <Button icon={<Download className="size-4" />} onClick={exportCases} disabled={!s.cases?.length}>
                Export
              </Button>
              {canEdit && (
                <>
                  <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                    Import
                  </Button>
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(newCase())}>
                    Add case
                  </Button>
                </>
              )}
            </div>
          </div>
          {!s.cases?.length ? (
            <EmptyState title="No test cases" description="Add cases one by one or import them from CSV / JSONL." />
          ) : (
            <div className="card">
              <Table>
                <thead>
                  <tr>
                    <th className="w-10">On</th>
                    <th>Name</th>
                    <th>Input</th>
                    <th>Expected</th>
                    <th>Tags</th>
                    <th>Evaluators</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id} className={clsx("hover:bg-page", !c.enabled && "opacity-50")}>
                      <td>
                        <input type="checkbox" checked={c.enabled} disabled={!canEdit} onChange={() => toggleCase.mutate(c)} />
                      </td>
                      <td className="font-medium">{c.name}</td>
                      <td className="max-w-xs truncate font-mono text-xs text-ink-2">{preview(c.input)}</td>
                      <td className="max-w-xs truncate font-mono text-xs text-ink-2">{preview(c.expected)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="text-xs text-ink-2">
                        {c.useSuiteEvaluators ? "suite" : "—"}
                        {c.evaluators.length ? ` + ${c.evaluators.length}` : ""}
                      </td>
                      <td className="text-right">
                        {canEdit && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c })}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => delCase.mutate(c.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}

      {tab === "evaluators" && (
        <Card title="Suite evaluators" actions={<span className="text-xs text-muted">Applied to every case (unless a case opts out)</span>}>
          <EvaluatorBuilder value={meta.evaluators} onChange={(evaluators) => setM({ evaluators })} readOnly={!canEdit} />
          <p className="mt-4 text-xs text-muted">
            A case passes when every evaluator marked <b>must pass</b> passes. The case score is the weighted average of evaluator scores (Jev probabilities / normalised scores, judge scores, assertions 0 or 1). All Jev evaluators for a result are sent to
            TypeSafe in a single request.
          </p>
        </Card>
      )}

      {tab === "settings" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="General">
            <fieldset disabled={!canEdit} className="space-y-3">
              <Field label="Name">
                <Input value={meta.name} onChange={(e) => setM({ name: e.target.value })} />
              </Field>
              <Field label="Description">
                <Textarea className="font-sans text-sm" value={meta.description} onChange={(e) => setM({ description: e.target.value })} />
              </Field>
              <Field label="Default concurrency">
                <Input type="number" min={1} max={32} value={meta.settings.concurrency} onChange={(e) => setM({ settings: { ...meta.settings, concurrency: Number(e.target.value) } })} />
              </Field>
            </fieldset>
          </Card>
          <Card title="Jev (TypeSafe)">
            <fieldset disabled={!canEdit} className="space-y-3">
              <Field label="Model" hint="jev-latest or a pinned version such as jev-1.13.0">
                <Input className="font-mono" value={meta.settings.jevModel} onChange={(e) => setM({ settings: { ...meta.settings, jevModel: e.target.value } })} />
              </Field>
              <Field label="API key secret name">
                <Input className="font-mono" value={meta.settings.jevApiKeySecret} onChange={(e) => setM({ settings: { ...meta.settings, jevApiKeySecret: e.target.value } })} />
              </Field>
            </fieldset>
          </Card>
          <Card title="Default targets" className="lg:col-span-2" actions={<span className="text-xs text-muted">Pre-selected in the run dialog and used by the CI API</span>}>
            <div className="flex flex-wrap gap-2">
              {targets.data?.map((t) => {
                const on = meta.defaultTargetIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    disabled={!canEdit}
                    onClick={() => setM({ defaultTargetIds: on ? meta.defaultTargetIds.filter((x) => x !== t.id) : [...meta.defaultTargetIds, t.id] })}
                    className={clsx("rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-accent-soft/50" : "border-line bg-raised text-ink-2")}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg bg-page p-3 font-mono text-[11px] text-ink-2">
              curl -X POST -H "Authorization: Bearer $AIEVAL_TOKEN" {window.location.origin}/api/v1/suites/{s.id}/runs
            </div>
          </Card>
        </div>
      )}

      {tab === "runs" && (
        <div className="card">
          {runs.data?.runs.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Targets</th>
                  <th>Pass rate</th>
                  <th>Duration</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {runs.data.runs.map((r) => (
                  <tr key={r.id} className="hover:bg-page">
                    <td>
                      <Link className="font-medium hover:text-accent" to={`/p/${projectId}/runs/${r.id}`}>
                        {r.name || `Run ${r.id.slice(-6)}`}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="text-xs">{Object.values(r.targetsSnapshot).map((t) => t.name).join(", ")}</td>
                    <td>
                      {r.passed}/{r.total} · {pct(r.total ? r.passed / r.total : null)}
                    </td>
                    <td className="text-xs">{duration(r.startedAt, r.finishedAt)}</td>
                    <td className="text-xs text-muted">{ago(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="p-6 text-center text-sm text-muted">No runs yet.</p>
          )}
        </div>
      )}

      {editing && <CaseEditor draft={editing} onClose={() => setEditing(null)} projectId={projectId} suiteId={suiteId} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} projectId={projectId} suiteId={suiteId} />}
      {running && <RunDialog suite={s} onClose={() => setRunning(false)} projectId={projectId} />}
      <Confirm open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete suite" message={<>Delete <b>{s.name}</b> with all its cases and runs?</>} />
    </>
  );
}
