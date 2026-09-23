import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Info, Play, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DEFAULT_TARGET_CONFIGS, TARGET_KIND_LABELS, TARGET_KINDS, type McpCapabilities, type TargetKind } from "@aieval/shared";
import { JsonEditor } from "../components/JsonEditor";
import { OutputView } from "../components/OutputView";
import { Badge, Button, Card, clsx, ErrorBox, Field, Input, KeyValueEditor, Loading, PageHeader, Select, Textarea, Toggle } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ms, usd } from "../lib/format";
import type { McpServer, Target, TryResult } from "../lib/types";
import { KIND_ICONS } from "./Targets";

type Config = Record<string, unknown>;

const KIND_DESCRIPTIONS: Record<TargetKind, string> = {
  OPENROUTER_MODEL: "Call any model on OpenRouter with a prompt template. Optionally give it MCP tools and let it run an agent loop.",
  HTTP_ENDPOINT: "Call your own REST API / AI endpoint. Template the request from the test case and pick the answer out of the response.",
  WORKFLOW: "Chain existing targets. Each step's output can feed the next step's input.",
  MCP_TOOL: "Call one tool on a registered MCP server with templated arguments.",
};

function TemplateHelp({ steps }: { steps?: boolean }) {
  return (
    <div className="flex gap-2 rounded-lg border border-accent/20 bg-accent-soft/30 px-3 py-2 text-xs text-ink-2">
      <Info className="mt-0.5 size-3.5 shrink-0 text-accent" />
      <div>
        Templates: <code className="code">{"{{input.question}}"}</code> reads the test case input, <code className="code">{"{{expected.answer}}"}</code> the expected value,{" "}
        <code className="code">{"{{secrets.MY_KEY}}"}</code> a project secret{steps && <>, <code className="code">{"{{steps.first.output}}"}</code> an earlier step</>}. In JSON, a value that is exactly{" "}
        <code className="code">{'"{{input}}"'}</code> keeps its type (objects, numbers).
      </div>
    </div>
  );
}

function ModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const models = useQuery({
    queryKey: ["openrouter-models"],
    queryFn: () => api.get<{ id: string; name: string; promptPrice: number | null; completionPrice: number | null; tools: boolean; contextLength?: number }[]>("/openrouter/models"),
    staleTime: 10 * 60_000,
  });
  const current = models.data?.find((m) => m.id === value);
  return (
    <Field
      label="Model"
      hint={
        current ? (
          <>
            {current.name} · ${current.promptPrice?.toFixed(2)}/${current.completionPrice?.toFixed(2)} per 1M tokens · {current.contextLength?.toLocaleString()} ctx {current.tools && "· supports tools"}
          </>
        ) : models.isLoading ? (
          "Loading OpenRouter catalog…"
        ) : (
          "Any OpenRouter model id, e.g. anthropic/claude-sonnet-4.5"
        )
      }
    >
      <Input list="or-models" value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" placeholder="provider/model" />
      <datalist id="or-models">
        {models.data?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
    </Field>
  );
}

function useMcpServers(projectId: string) {
  return useQuery({ queryKey: ["mcp-servers", projectId], queryFn: () => api.get<McpServer[]>(p(projectId, "/mcp-servers")) });
}

function OpenRouterForm({ config, set, projectId }: { config: Config; set: (patch: Config) => void; projectId: string }) {
  const servers = useMcpServers(projectId);
  const attached = (config.mcpServerIds as string[]) ?? [];
  const allowed = (config.allowedTools as string[]) ?? [];
  const details = useQueries({
    queries: attached.map((id) => ({ queryKey: ["mcp-server", projectId, id], queryFn: () => api.get<McpServer>(p(projectId, `/mcp-servers/${id}`)) })),
  });
  const availableTools = details.flatMap((d) => (d.data?.capabilities as McpCapabilities | undefined)?.tools.map((t) => `${d.data!.name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_")) ?? []);

  return (
    <div className="space-y-4">
      <ModelPicker value={String(config.model ?? "")} onChange={(model) => set({ model })} />
      <Field label="System prompt">
        <Textarea rows={3} value={String(config.systemPrompt ?? "")} onChange={(e) => set({ systemPrompt: e.target.value })} />
      </Field>
      <Field label="User prompt template" hint="Sent as the user message. Leave empty to send the whole input.">
        <Textarea rows={4} value={String(config.promptTemplate ?? "")} onChange={(e) => set({ promptTemplate: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Temperature">
          <Input type="number" step="0.1" min={0} max={2} value={config.temperature === undefined ? "" : String(config.temperature)} onChange={(e) => set({ temperature: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </Field>
        <Field label="Max tokens">
          <Input type="number" min={1} value={config.maxTokens === undefined ? "" : String(config.maxTokens)} onChange={(e) => set({ maxTokens: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </Field>
        <Field label="Top P">
          <Input type="number" step="0.05" min={0} max={1} value={config.topP === undefined ? "" : String(config.topP)} onChange={(e) => set({ topP: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </Field>
        <Field label="Response format">
          <Select value={String(config.responseFormat ?? "text")} onChange={(e) => set({ responseFormat: e.target.value })}>
            <option value="text">Text</option>
            <option value="json_object">JSON object</option>
          </Select>
        </Field>
      </div>

      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 text-sm font-medium">MCP tools (agent loop)</div>
        {!servers.data?.length ? (
          <p className="text-xs text-muted">
            No MCP servers registered.{" "}
            <Link to={`/p/${projectId}/mcp`} className="text-accent hover:underline">
              Add one
            </Link>{" "}
            to let this model call tools.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {servers.data.map((s) => {
                const on = attached.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => set({ mcpServerIds: on ? attached.filter((x) => x !== s.id) : [...attached, s.id] })}
                    className={clsx("rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-accent-soft/50" : "border-line bg-raised text-ink-2 hover:bg-page")}
                  >
                    {s.name} {s.counts && <span className="text-muted">· {s.counts.tools} tools</span>}
                  </button>
                );
              })}
            </div>
            {availableTools.length > 0 && (
              <Field label="Allowed tools" hint="None selected = all tools of the attached servers are exposed.">
                <div className="flex flex-wrap gap-1.5">
                  {availableTools.map((t) => {
                    const on = allowed.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => set({ allowedTools: on ? allowed.filter((x) => x !== t) : [...allowed, t] })}
                        className={clsx("rounded-md border px-2 py-0.5 font-mono text-[11px]", on ? "border-accent bg-accent-soft/50" : "border-line bg-raised text-ink-2")}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            <Field label="Max tool iterations" className="w-48">
              <Input type="number" min={1} max={50} value={String(config.maxToolIterations ?? 8)} onChange={(e) => set({ maxToolIterations: Number(e.target.value) })} />
            </Field>
          </div>
        )}
      </div>

      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="API key secret name">
              <Input className="font-mono" value={String(config.apiKeySecret ?? "OPENROUTER_API_KEY")} onChange={(e) => set({ apiKeySecret: e.target.value })} />
            </Field>
            <Field label="Timeout (ms)">
              <Input type="number" value={String(config.timeoutMs ?? 120000)} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Extra request body" hint='Merged into the chat completion request, e.g. {"provider": {"order": ["openai"]}} or {"reasoning": {"effort": "low"}}'>
            <JsonEditor value={config.extraBody ?? {}} onChange={(extraBody) => set({ extraBody })} height="100px" />
          </Field>
        </div>
      </details>
    </div>
  );
}

function HttpForm({ config, set }: { config: Config; set: (patch: Config) => void }) {
  const bodyType = String(config.bodyType ?? "json");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select className="w-28" value={String(config.method ?? "POST")} onChange={(e) => set({ method: e.target.value })}>
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
        <Input className="flex-1 font-mono" value={String(config.url ?? "")} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com/v1/chat" />
      </div>
      <Field label="Headers" hint="Use {{secrets.NAME}} for API keys, e.g. Authorization: Bearer {{secrets.MY_API_KEY}}">
        <KeyValueEditor value={(config.headers as Record<string, string>) ?? {}} onChange={(headers) => set({ headers })} keyPlaceholder="Header" />
      </Field>
      <Field label="Query parameters">
        <KeyValueEditor value={(config.query as Record<string, string>) ?? {}} onChange={(query) => set({ query })} keyPlaceholder="param" />
      </Field>
      {config.method !== "GET" && (
        <>
          <Field label="Body type">
            <Select className="w-40" value={bodyType} onChange={(e) => set({ bodyType: e.target.value, body: e.target.value === "text" ? "{{input.prompt}}" : e.target.value === "json" ? { input: "{{input}}" } : null })}>
              <option value="json">JSON</option>
              <option value="text">Text</option>
              <option value="none">None</option>
            </Select>
          </Field>
          {bodyType === "json" && (
            <Field label="Body (JSON template)">
              <JsonEditor value={config.body ?? {}} onChange={(body) => set({ body })} height="140px" />
            </Field>
          )}
          {bodyType === "text" && (
            <Field label="Body (text template)">
              <Textarea rows={4} value={String(config.body ?? "")} onChange={(e) => set({ body: e.target.value })} />
            </Field>
          )}
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Output path (JSONPath)" hint="Which part of the response to evaluate, e.g. $.choices[0].message.content. Empty = whole body.">
          <Input className="font-mono" value={String(config.outputPath ?? "")} onChange={(e) => set({ outputPath: e.target.value })} placeholder="$.answer" />
        </Field>
        <Field label="Timeout (ms)">
          <Input type="number" value={String(config.timeoutMs ?? 60000)} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
        </Field>
      </div>
      <Toggle checked={config.failOnHttpError !== false} onChange={(failOnHttpError) => set({ failOnHttpError })} label="Treat non-2xx responses as errors (disable to test error handling with assertions)" />
    </div>
  );
}

function WorkflowForm({ config, set, projectId, selfId }: { config: Config; set: (patch: Config) => void; projectId: string; selfId?: string }) {
  const targets = useQuery({ queryKey: ["targets", projectId], queryFn: () => api.get<Target[]>(p(projectId, "/targets")) });
  const steps = (config.steps as { name: string; targetId: string; input: unknown; continueOnError: boolean }[]) ?? [];
  const setSteps = (s: typeof steps) => set({ steps: s });
  const options = targets.data?.filter((t) => t.id !== selfId) ?? [];

  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={i} className="rounded-lg border border-line bg-raised p-3">
          <div className="mb-3 flex items-center justify-between">
            <Badge tone="accent">Step {i + 1}</Badge>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setSteps(steps.map((x, j) => (j === i - 1 ? steps[i] : j === i ? steps[i - 1] : x)))}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" disabled={i === steps.length - 1} onClick={() => setSteps(steps.map((x, j) => (j === i + 1 ? steps[i] : j === i ? steps[i + 1] : x)))}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Step name" hint={`Reference later as {{steps.${s.name || "name"}.output}}`}>
              <Input className="font-mono" value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") } : x)))} />
            </Field>
            <Field label="Target">
              <Select value={s.targetId} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, targetId: e.target.value } : x)))}>
                <option value="">Select a target…</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({TARGET_KIND_LABELS[t.kind]})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Step input (becomes the target's {{input}})" className="mt-3">
            <JsonEditor value={s.input} onChange={(input) => setSteps(steps.map((x, j) => (j === i ? { ...x, input } : x)))} height="90px" />
          </Field>
          <div className="mt-2">
            <Toggle checked={s.continueOnError} onChange={(continueOnError) => setSteps(steps.map((x, j) => (j === i ? { ...x, continueOnError } : x)))} label="Continue if this step fails" />
          </div>
        </div>
      ))}
      <Button
        icon={<Plus className="size-4" />}
        onClick={() =>
          setSteps([
            ...steps,
            {
              name: `step${steps.length + 1}`,
              targetId: "",
              input: steps.length ? { prompt: `{{steps.${steps[steps.length - 1].name}.output}}` } : "{{input}}",
              continueOnError: false,
            },
          ])
        }
      >
        Add step
      </Button>
      <Field label="Final output template" hint="Empty = output of the last step. Example: {{steps.draft.output}} / {{steps.review.output}}">
        <Textarea rows={2} value={String(config.outputTemplate ?? "")} onChange={(e) => set({ outputTemplate: e.target.value })} />
      </Field>
    </div>
  );
}

/** {"type":"object","properties":{"q":..}} → {"q": "{{input.q}}"} */
function argsFromSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const props = (schema?.properties ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(props).map((k) => [k, `{{input.${k}}}`]));
}

function McpToolForm({ config, set, projectId }: { config: Config; set: (patch: Config) => void; projectId: string }) {
  const servers = useMcpServers(projectId);
  const serverId = String(config.serverId ?? "");
  const server = useQuery({
    queryKey: ["mcp-server", projectId, serverId],
    enabled: Boolean(serverId),
    queryFn: () => api.get<McpServer>(p(projectId, `/mcp-servers/${serverId}`)),
  });
  const tools = (server.data?.capabilities as McpCapabilities | undefined)?.tools ?? [];
  const tool = tools.find((t) => t.name === config.toolName);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="MCP server">
          <Select value={serverId} onChange={(e) => set({ serverId: e.target.value, toolName: "" })}>
            <option value="">Select a server…</option>
            {servers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tool">
          <Select
            value={String(config.toolName ?? "")}
            onChange={(e) => {
              const t = tools.find((x) => x.name === e.target.value);
              set({ toolName: e.target.value, args: argsFromSchema(t?.inputSchema) });
            }}
            disabled={!tools.length}
          >
            <option value="">{server.isLoading ? "Loading…" : tools.length ? "Select a tool…" : "No tools (test the server first)"}</option>
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {tool && (
        <div className="rounded-lg border border-line bg-page p-3 text-xs text-ink-2">
          {tool.description && <p className="mb-2">{tool.description}</p>}
          <details>
            <summary className="cursor-pointer font-medium">Input schema</summary>
            <pre className="mt-2 overflow-auto font-mono">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
          </details>
        </div>
      )}
      <Field label="Arguments (JSON template)">
        <JsonEditor value={config.args ?? {}} onChange={(args) => set({ args })} height="140px" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Output path (JSONPath, optional)" hint="Into structured content or JSON text">
          <Input className="font-mono" value={String(config.outputPath ?? "")} onChange={(e) => set({ outputPath: e.target.value })} />
        </Field>
        <Field label="Timeout (ms)">
          <Input type="number" value={String(config.timeoutMs ?? 60000)} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
        </Field>
      </div>
      <Toggle checked={config.failOnToolError !== false} onChange={(failOnToolError) => set({ failOnToolError })} label="Treat tool errors (isError) as failures" />
    </div>
  );
}

function defaultInputFor(kind: TargetKind): unknown {
  return kind === "HTTP_ENDPOINT" ? { prompt: "Hello there" } : kind === "MCP_TOOL" ? { message: "hello" } : { prompt: "What is the capital of France?" };
}

export function TargetEditorPage() {
  const { projectId, canEdit } = useProject();
  const { targetId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = !targetId;

  const existing = useQuery({ queryKey: ["target", projectId, targetId], enabled: !isNew, queryFn: () => api.get<Target>(p(projectId, `/targets/${targetId}`)) });
  const [kind, setKind] = useState<TargetKind | null>((params.get("kind") as TargetKind) || null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<Config>({});
  const [tryInput, setTryInput] = useState<unknown>({});
  const [tryExpected, setTryExpected] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setKind(existing.data.kind);
      setName(existing.data.name);
      setDescription(existing.data.description);
      setConfig(existing.data.config);
      setTryInput(defaultInputFor(existing.data.kind));
      setDirty(false);
    }
  }, [existing.data]);

  const chooseKind = (k: TargetKind) => {
    setKind(k);
    setConfig(structuredClone(DEFAULT_TARGET_CONFIGS[k]) as Config);
    setTryInput(defaultInputFor(k));
    if (!name) setName(k === "OPENROUTER_MODEL" ? "GPT-4o mini" : k === "HTTP_ENDPOINT" ? "My API" : k === "WORKFLOW" ? "My workflow" : "MCP tool");
  };

  const set = (patch: Config) => {
    setConfig((c) => {
      const next = { ...c, ...patch };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
      return next;
    });
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, kind, config };
      return isNew ? api.post<Target>(p(projectId, "/targets"), body) : api.put<Target>(p(projectId, `/targets/${targetId}`), body);
    },
    onSuccess: (t) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["targets", projectId] });
      qc.setQueryData(["target", projectId, t.id], t);
      if (isNew) navigate(`/p/${projectId}/targets/${t.id}`, { replace: true });
    },
  });

  const tryIt = useMutation({
    mutationFn: () => api.post<TryResult>(p(projectId, "/targets/try"), { kind, config, input: tryInput, expected: tryExpected, targetId }),
  });

  const title = useMemo(() => (isNew ? "New target" : (existing.data?.name ?? "Target")), [isNew, existing.data]);

  if (!isNew && existing.isLoading) return <Loading />;

  if (!kind) {
    return (
      <>
        <PageHeader title="New target" subtitle="What do you want to test?" back={<Link to={`/p/${projectId}/targets`}>← Targets</Link>} />
        <div className="grid gap-4 sm:grid-cols-2">
          {TARGET_KINDS.map((k) => {
            const Icon = KIND_ICONS[k];
            return (
              <button key={k} onClick={() => chooseKind(k)} className="card p-5 text-left transition hover:border-accent/50 hover:shadow-sm">
                <Icon className="mb-3 size-6 text-accent" />
                <div className="font-semibold">{TARGET_KIND_LABELS[k]}</div>
                <p className="mt-1 text-sm text-ink-2">{KIND_DESCRIPTIONS[k]}</p>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  const Icon = KIND_ICONS[kind];
  const result = tryIt.data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Icon className="size-5 text-accent" /> {title}
          </span>
        }
        subtitle={KIND_DESCRIPTIONS[kind]}
        back={<Link to={`/p/${projectId}/targets`}>← Targets</Link>}
        actions={
          canEdit && (
            <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!name.trim() || (!dirty && !isNew)} onClick={() => save.mutate()}>
              {isNew ? "Create target" : dirty ? "Save changes" : "Saved"}
            </Button>
          )
        }
      />
      <ErrorBox error={save.error} className="mb-4" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <Card title="Details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Description">
                <Input
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Optional"
                />
              </Field>
            </div>
          </Card>
          <Card title={`${TARGET_KIND_LABELS[kind]} configuration`}>
            <div className="mb-4">
              <TemplateHelp steps={kind === "WORKFLOW"} />
            </div>
            {kind === "OPENROUTER_MODEL" && <OpenRouterForm config={config} set={set} projectId={projectId} />}
            {kind === "HTTP_ENDPOINT" && <HttpForm config={config} set={set} />}
            {kind === "WORKFLOW" && <WorkflowForm config={config} set={set} projectId={projectId} selfId={targetId} />}
            {kind === "MCP_TOOL" && <McpToolForm config={config} set={set} projectId={projectId} />}
          </Card>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card
            title="Try it"
            actions={
              <Button variant="primary" size="sm" icon={<Play className="size-3.5" />} loading={tryIt.isPending} onClick={() => tryIt.mutate()} disabled={!canEdit}>
                Run once
              </Button>
            }
          >
            <p className="mb-3 text-xs text-muted">Runs the current (unsaved) configuration with a sample test case input.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="input">
                <JsonEditor value={tryInput} onChange={setTryInput} height="110px" />
              </Field>
              <Field label="expected (optional)">
                <JsonEditor value={tryExpected} onChange={setTryExpected} height="110px" />
              </Field>
            </div>
            <ErrorBox error={tryIt.error} className="mt-3" />
            {result && (
              <div className="mt-4">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  {result.ok ? <Badge tone="good">Success</Badge> : <Badge tone="bad">Error</Badge>}
                  {result.statusCode !== undefined && <Badge>HTTP {result.statusCode}</Badge>}
                  {result.latencyMs !== undefined && <Badge>{ms(result.latencyMs)}</Badge>}
                  {result.usage?.costUsd ? <Badge>{usd(result.usage.costUsd)}</Badge> : null}
                  {result.usage?.inputTokens ? (
                    <Badge>
                      {result.usage.inputTokens} in / {result.usage.outputTokens} out tokens
                    </Badge>
                  ) : null}
                </div>
                {result.error && <ErrorBox error={result.error} className="mb-3" />}
                <OutputView output={result.output} outputJson={result.outputJson} raw={result.raw} toolCalls={result.toolCalls} trace={result.trace} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
