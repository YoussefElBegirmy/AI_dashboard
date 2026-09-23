import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, MessageSquare, Pencil, Play, RefreshCw, Target as TargetIcon, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MCP_TRANSPORT_LABELS, type McpCapabilities, type McpToolInfo } from "@aieval/shared";
import { CodeView, JsonEditor } from "../components/JsonEditor";
import { defaultsFromSchema, SchemaForm } from "../components/SchemaForm";
import { Badge, Button, Card, clsx, Confirm, ErrorBox, Field, Input, Loading, Modal, PageHeader, StatusBadge, Tabs } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago, ms } from "../lib/format";
import type { McpServer, Target } from "../lib/types";
import { McpServerFormFields, type McpForm } from "./McpServers";
import { McpOAuthPanel } from "../components/McpOAuthPanel";

type Tab = "tools" | "resources" | "prompts";

function Playground({ projectId, server, tool, canEdit }: { projectId: string; server: McpServer; tool: McpToolInfo; canEdit: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [args, setArgs] = useState<Record<string, unknown>>(() => defaultsFromSchema(tool.inputSchema as never));
  const [raw, setRaw] = useState(false);
  useEffect(() => setArgs(defaultsFromSchema(tool.inputSchema as never)), [tool]);

  const call = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; latencyMs: number; result?: unknown; text?: string; json?: unknown; isError?: boolean; error?: string }>(p(projectId, `/mcp-servers/${server.id}/tools/call`), {
        name: tool.name,
        args,
      }),
  });
  const makeTarget = useMutation({
    mutationFn: () =>
      api.post<Target>(p(projectId, "/targets"), {
        name: `${server.name} · ${tool.name}`,
        kind: "MCP_TOOL",
        config: {
          serverId: server.id,
          toolName: tool.name,
          args: Object.fromEntries(Object.keys((tool.inputSchema.properties as object) ?? {}).map((k) => [k, `{{input.${k}}}`])),
        },
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["targets", projectId] });
      navigate(`/p/${projectId}/targets/${t.id}`);
    },
  });
  const r = call.data;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Wrench className="size-4 text-accent" />
          <span className="font-mono">{tool.name}</span>
        </span>
      }
      actions={
        canEdit && (
          <Button size="sm" icon={<TargetIcon className="size-3.5" />} loading={makeTarget.isPending} onClick={() => makeTarget.mutate()}>
            Create test target
          </Button>
        )
      }
    >
      {tool.description && <p className="mb-4 whitespace-pre-wrap text-sm text-ink-2">{tool.description}</p>}
      {tool.annotations && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {Object.entries(tool.annotations)
            .filter(([, v]) => v === true)
            .map(([k]) => (
              <Badge key={k}>{k.replace(/Hint$/, "")}</Badge>
            ))}
        </div>
      )}
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">Arguments</span>
        <button className="text-xs text-accent hover:underline" onClick={() => setRaw((x) => !x)}>
          {raw ? "Form" : "Raw JSON"}
        </button>
      </div>
      {raw ? <JsonEditor value={args} onChange={(v) => setArgs((v ?? {}) as Record<string, unknown>)} height="160px" /> : <SchemaForm schema={tool.inputSchema as never} value={args} onChange={setArgs} />}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" icon={<Play className="size-4" />} loading={call.isPending} onClick={() => call.mutate()} disabled={!canEdit}>
          Call tool
        </Button>
        {r && (
          <span className="flex items-center gap-2 text-xs">
            {r.ok && !r.isError ? <Badge tone="good">OK</Badge> : <Badge tone="bad">{r.ok ? "Tool error" : "Failed"}</Badge>}
            <span className="tabular text-muted">{ms(r.latencyMs)}</span>
          </span>
        )}
      </div>
      <ErrorBox error={call.error ?? r?.error} className="mt-3" />
      {r?.ok && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="label">Text content</div>
            <CodeView value={r.text ?? ""} maxHeight="16rem" />
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-ink-2">Raw result</summary>
            <CodeView value={r.result} className="mt-2" />
          </details>
        </div>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-ink-2">Input schema</summary>
        <CodeView value={tool.inputSchema} className="mt-2" maxHeight="16rem" />
      </details>
    </Card>
  );
}

function ResourceReader({ projectId, serverId, uri }: { projectId: string; serverId: string; uri: string }) {
  const read = useMutation({ mutationFn: () => api.post<{ ok: boolean; result?: unknown; error?: string; latencyMs: number }>(p(projectId, `/mcp-servers/${serverId}/resources/read`), { uri }) });
  return (
    <div>
      <Button size="sm" onClick={() => read.mutate()} loading={read.isPending}>
        Read
      </Button>
      <ErrorBox error={read.error ?? read.data?.error} className="mt-2" />
      {read.data?.ok && <CodeView value={read.data.result} className="mt-2" maxHeight="16rem" />}
    </div>
  );
}

function PromptTester({ projectId, serverId, prompt }: { projectId: string; serverId: string; prompt: McpCapabilities["prompts"][number] }) {
  const [args, setArgs] = useState<Record<string, string>>({});
  const get = useMutation({ mutationFn: () => api.post<{ ok: boolean; result?: unknown; error?: string }>(p(projectId, `/mcp-servers/${serverId}/prompts/get`), { name: prompt.name, args }) });
  return (
    <div className="space-y-2">
      {prompt.arguments?.map((a) => (
        <Field key={a.name} label={`${a.name}${a.required ? " *" : ""}`} hint={a.description}>
          <Input value={args[a.name] ?? ""} onChange={(e) => setArgs({ ...args, [a.name]: e.target.value })} />
        </Field>
      ))}
      <Button size="sm" onClick={() => get.mutate()} loading={get.isPending}>
        Get prompt
      </Button>
      <ErrorBox error={get.error ?? get.data?.error} />
      {get.data?.ok && <CodeView value={get.data.result} maxHeight="16rem" />}
    </div>
  );
}

export function McpServerDetailPage() {
  const { projectId, canEdit, isOwner } = useProject();
  const { serverId = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const server = useQuery({ queryKey: ["mcp-server", projectId, serverId], queryFn: () => api.get<McpServer>(p(projectId, `/mcp-servers/${serverId}`)) });
  const [tab, setTab] = useState<Tab>("tools");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<McpForm | null>(null);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["mcp-server", projectId, serverId] });
    qc.invalidateQueries({ queryKey: ["mcp-servers", projectId] });
  };
  const test = useMutation({ mutationFn: () => api.post<{ ok: boolean; error?: string; latencyMs: number }>(p(projectId, `/mcp-servers/${serverId}/test`)), onSettled: invalidate });
  const save = useMutation({
    mutationFn: (f: McpForm) => api.put(p(projectId, `/mcp-servers/${serverId}`), f),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(p(projectId, `/mcp-servers/${serverId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers", projectId] });
      navigate(`/p/${projectId}/mcp`);
    },
  });

  if (server.isLoading || !server.data) return server.error ? <ErrorBox error={server.error} /> : <Loading />;
  const s = server.data;
  const caps = s.capabilities;
  const tools = caps?.tools ?? [];
  const shownTools = tools.filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.description?.toLowerCase().includes(filter.toLowerCase()));
  const tool = tools.find((t) => t.name === selected) ?? null;

  return (
    <>
      <PageHeader
        back={<Link to={`/p/${projectId}/mcp`}>← MCP servers</Link>}
        title={
          <span className="flex items-center gap-3">
            {s.name} <StatusBadge status={s.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs">
            {MCP_TRANSPORT_LABELS[s.transport]} · {s.transport === "STDIO" ? `${s.config.command} ${s.config.args.join(" ")}` : s.config.url}
            {caps?.serverInfo?.name && ` · ${caps.serverInfo.name} ${caps.serverInfo.version ?? ""}`} · checked {ago(s.lastCheckedAt)}
          </span>
        }
        actions={
          <>
            <Button icon={<RefreshCw className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
              Test connection
            </Button>
            {canEdit && (
              <>
                <Button icon={<Pencil className="size-4" />} onClick={() => setEditing({ name: s.name, description: s.description, transport: s.transport, config: s.config })}>
                  Edit
                </Button>
                <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />
              </>
            )}
          </>
        }
      />
      <McpOAuthPanel server={s} projectId={projectId} canEdit={canEdit} onChange={invalidate} />
      {s.status === "error" && s.lastError && !(s.oauth && s.oauth.status !== "authorized") && <ErrorBox error={s.lastError} className="mb-4" />}
      {test.data?.ok && <div className="mb-4 rounded-lg border border-good/30 bg-good/5 px-3 py-2 text-sm text-good-text">Connected in {ms(test.data.latencyMs)} — capabilities refreshed.</div>}
      {caps?.instructions && (
        <details className="card mb-4 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Server instructions</summary>
          <p className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm text-ink-2">{caps.instructions}</p>
        </details>
      )}

      <Tabs
        tabs={[
          { id: "tools", label: `Tools (${tools.length})` },
          { id: "resources", label: `Resources (${(caps?.resources.length ?? 0) + (caps?.resourceTemplates.length ?? 0)})` },
          { id: "prompts", label: `Prompts (${caps?.prompts.length ?? 0})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {!caps ? (
        <p className="text-sm text-muted">No capabilities yet — test the connection.</p>
      ) : tab === "tools" ? (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="card self-start p-2">
            <Input placeholder="Filter tools…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-2" />
            <div className="max-h-[65vh] space-y-0.5 overflow-y-auto">
              {shownTools.map((t) => (
                <button key={t.name} onClick={() => setSelected(t.name)} className={clsx("block w-full rounded-lg px-3 py-2 text-left hover:bg-page", selected === t.name && "bg-accent-soft/50")}>
                  <div className="font-mono text-xs font-medium">{t.name}</div>
                  {t.description && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{t.description}</div>}
                </button>
              ))}
              {!shownTools.length && <p className="p-3 text-xs text-muted">No tools.</p>}
            </div>
          </div>
          {tool ? (
            <Playground key={tool.name} projectId={projectId} server={s} tool={tool} canEdit={canEdit} />
          ) : (
            <div className="card flex items-center justify-center p-10 text-sm text-muted">
              <Wrench className="mr-2 size-4" /> Select a tool to open the playground
            </div>
          )}
        </div>
      ) : tab === "resources" ? (
        <div className="space-y-3">
          {caps.resources.map((r) => (
            <Card
              key={r.uri}
              title={
                <span className="flex items-center gap-2">
                  <FileText className="size-4 text-muted" />
                  {r.name ?? r.uri}
                </span>
              }
            >
              <div className="mb-2 font-mono text-xs text-muted">
                {r.uri} {r.mimeType && `· ${r.mimeType}`}
              </div>
              {r.description && <p className="mb-2 text-sm text-ink-2">{r.description}</p>}
              <ResourceReader projectId={projectId} serverId={s.id} uri={r.uri} />
            </Card>
          ))}
          {caps.resourceTemplates.map((r) => (
            <Card key={r.uriTemplate} title={r.name ?? r.uriTemplate}>
              <div className="font-mono text-xs text-muted">template: {r.uriTemplate}</div>
              {r.description && <p className="mt-1 text-sm text-ink-2">{r.description}</p>}
            </Card>
          ))}
          {!caps.resources.length && !caps.resourceTemplates.length && <p className="text-sm text-muted">This server exposes no resources.</p>}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {caps.prompts.map((pr) => (
            <Card
              key={pr.name}
              title={
                <span className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-muted" />
                  <span className="font-mono">{pr.name}</span>
                </span>
              }
            >
              {pr.description && <p className="mb-3 text-sm text-ink-2">{pr.description}</p>}
              <PromptTester projectId={projectId} serverId={s.id} prompt={pr} />
            </Card>
          ))}
          {!caps.prompts.length && <p className="text-sm text-muted">This server exposes no prompts.</p>}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit MCP server"
        wide
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => editing && save.mutate(editing)}>
              Save & reconnect
            </Button>
          </>
        }
      >
        {editing && <McpServerFormFields form={editing} setForm={setEditing} isOwner={isOwner} />}
        <ErrorBox error={save.error} className="mt-4" />
      </Modal>
      <Confirm
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        title="Delete MCP server"
        message={
          <>
            Delete <b>{s.name}</b>? Targets using it must be removed first.
            <ErrorBox error={del.error} className="mt-3" />
          </>
        }
      />
    </>
  );
}
