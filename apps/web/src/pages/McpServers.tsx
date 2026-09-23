import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, KeyRound, Plug, Plus, RefreshCw, Terminal } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DEFAULT_MCP_AUTH, MCP_TRANSPORT_LABELS, MCP_TRANSPORTS, type McpTransport } from "@aieval/shared";
import { Badge, Button, clsx, EmptyState, ErrorBox, Field, Input, KeyValueEditor, Loading, Modal, PageHeader, Select, StatusBadge, Table } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago } from "../lib/format";
import type { McpServer } from "../lib/types";

export interface McpForm {
  name: string;
  description: string;
  transport: McpTransport;
  config: McpServer["config"];
}

export const emptyMcpForm = (): McpForm => ({
  name: "",
  description: "",
  transport: "STREAMABLE_HTTP",
  config: { url: "", headers: {}, command: "", args: [], env: {}, cwd: "", timeoutMs: 30000, auth: { ...DEFAULT_MCP_AUTH } },
});

/** Every scope the Hexifyer authorization server can grant; the consent screen can untick any. */
const HEXIFYER_SCOPES = "projects:read tasks:read topics:read sprints:read tasks:write topics:write sprints:write";

const PRESETS: { label: string; form: Partial<Omit<McpForm, "config">> & { config: Partial<McpServer["config"]> } }[] = [
  { label: "Everything (reference server, stdio)", form: { name: "everything", transport: "STDIO", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] } } },
  { label: "Filesystem (stdio)", form: { name: "filesystem", transport: "STDIO", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] } } },
  { label: "Remote HTTP server (token header)", form: { name: "remote", transport: "STREAMABLE_HTTP", config: { url: "https://example.com/mcp", headers: { Authorization: "Bearer {{secrets.MCP_TOKEN}}" } } } },
  { label: "Remote server (OAuth 2.1)", form: { name: "remote-oauth", transport: "STREAMABLE_HTTP", config: { url: "https://example.com/mcp", auth: { ...DEFAULT_MCP_AUTH, type: "oauth" } } } },
  {
    label: "Hexifyer Polaris (OAuth)",
    form: { name: "polaris", description: "Hexifyer Polaris connector", transport: "STREAMABLE_HTTP", config: { url: "https://<your-mcp-host>/polaris/mcp", auth: { ...DEFAULT_MCP_AUTH, type: "oauth", scope: HEXIFYER_SCOPES } } },
  },
  {
    label: "Hexifyer DevStudio (OAuth)",
    form: { name: "devstudio", description: "Hexifyer DevStudio connector", transport: "STREAMABLE_HTTP", config: { url: "https://<your-mcp-host>/devstudio/mcp", auth: { ...DEFAULT_MCP_AUTH, type: "oauth", scope: HEXIFYER_SCOPES } } },
  },
];

export function McpServerFormFields({ form: raw, setForm, isOwner }: { form: McpForm; setForm: (f: McpForm) => void; isOwner: boolean }) {
  // servers saved before OAuth support have no auth block
  const form: McpForm = { ...raw, config: { ...raw.config, auth: { ...DEFAULT_MCP_AUTH, ...raw.config.auth } } };
  const c = form.config;
  const setC = (patch: Partial<McpServer["config"]>) => setForm({ ...form, config: { ...c, ...patch } });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="Used as the tool prefix, e.g. name__tool">
          <Input className="font-mono" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.replace(/[^A-Za-z0-9_-]/g, "-") })} />
        </Field>
        <Field label="Transport">
          <Select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as McpTransport })}>
            {MCP_TRANSPORTS.map((t) => (
              <option key={t} value={t} disabled={t === "STDIO" && !isOwner}>
                {MCP_TRANSPORT_LABELS[t]}
                {t === "STDIO" && !isOwner ? " (owners only)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description">
        <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
      </Field>
      {form.transport === "STDIO" ? (
        <>
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-text">Stdio servers run as a local process on the dashboard host. Only add commands you trust.</div>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Command">
              <Input className="font-mono" value={c.command} onChange={(e) => setC({ command: e.target.value })} placeholder="npx" />
            </Field>
            <Field label="Arguments" hint="Space separated; wrap in quotes to keep spaces">
              <Input
                className="font-mono"
                value={c.args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}
                onChange={(e) => setC({ args: (e.target.value.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, "")) })}
                placeholder="-y @modelcontextprotocol/server-everything"
              />
            </Field>
          </div>
          <Field label="Environment variables" hint="Values support {{secrets.NAME}}">
            <KeyValueEditor value={c.env} onChange={(env) => setC({ env })} keyPlaceholder="VAR" />
          </Field>
          <Field label="Working directory (optional)">
            <Input className="font-mono" value={c.cwd} onChange={(e) => setC({ cwd: e.target.value })} />
          </Field>
        </>
      ) : (
        <>
          <Field label="URL">
            <Input className="font-mono" value={c.url} onChange={(e) => setC({ url: e.target.value })} placeholder="https://your-server.example.com/mcp" />
          </Field>
          <AuthFields form={form} setForm={setForm} />
          <Field
            label={c.auth.type === "oauth" ? "Extra headers (optional)" : "Headers"}
            hint={c.auth.type === "oauth" ? "Sent alongside the OAuth bearer token" : "e.g. Authorization: Bearer {{secrets.MCP_TOKEN}}"}
          >
            <KeyValueEditor value={c.headers} onChange={(headers) => setC({ headers })} keyPlaceholder="Header" />
          </Field>
        </>
      )}
      <Field label="Request timeout (ms)" className="w-48">
        <Input type="number" value={c.timeoutMs} onChange={(e) => setC({ timeoutMs: Number(e.target.value) })} />
      </Field>
    </div>
  );
}

function AuthFields({ form, setForm }: { form: McpForm; setForm: (f: McpForm) => void }) {
  const auth = form.config.auth;
  const setAuth = (patch: Partial<McpForm["config"]["auth"]>) => setForm({ ...form, config: { ...form.config, auth: { ...auth, ...patch } } });
  const redirect = `${window.location.origin}/api/mcp-oauth/callback`;
  return (
    <div className="rounded-lg border border-line p-3">
      <Field label="Authentication">
        <div className="flex overflow-hidden rounded-lg border border-line text-sm">
          {(["none", "oauth"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAuth({ type: t })}
              className={clsx("flex-1 px-3 py-1.5", auth.type === t ? "bg-accent text-white" : "bg-raised text-ink-2 hover:bg-page")}
            >
              {t === "none" ? "None / static headers" : "OAuth 2.1"}
            </button>
          ))}
        </div>
      </Field>
      {auth.type === "oauth" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-ink-2">
            Follows the MCP authorization spec: the dashboard discovers the authorization server from the URL, registers itself as a client, and you sign in once (PKCE). Tokens are stored
            encrypted and refreshed automatically. Everyone in this project then uses this connection.
          </p>
          <Field label="Scopes (optional)" hint="Space separated. Empty = every scope the server advertises. The consent screen can narrow them further.">
            <Input className="font-mono text-xs" value={auth.scope} onChange={(e) => setAuth({ scope: e.target.value })} placeholder="e.g. projects:read tasks:read tasks:write" />
          </Field>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-ink-2">Client settings (advanced)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Client name" hint="Shown on the consent screen">
                <Input value={auth.clientName} onChange={(e) => setAuth({ clientName: e.target.value })} />
              </Field>
              <Field label="Pre-registered client ID" hint="Leave empty to use dynamic client registration">
                <Input className="font-mono text-xs" value={auth.clientId} onChange={(e) => setAuth({ clientId: e.target.value })} />
              </Field>
              <Field label="Client secret (project secret name)" hint="Only for confidential clients">
                <Input
                  className="font-mono text-xs"
                  value={auth.clientSecretName}
                  onChange={(e) => setAuth({ clientSecretName: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })}
                  placeholder="MCP_CLIENT_SECRET"
                />
              </Field>
              <Field label="Redirect URI to register" hint="Only needed with a pre-registered client">
                <Input readOnly className="font-mono text-xs" value={redirect} onFocus={(e) => e.target.select()} />
              </Field>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export function McpServersPage() {
  const { projectId, canEdit, isOwner } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const servers = useQuery({ queryKey: ["mcp-servers", projectId], queryFn: () => api.get<McpServer[]>(p(projectId, "/mcp-servers")) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<McpForm>(emptyMcpForm());
  const create = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string; server: McpServer }>(p(projectId, "/mcp-servers"), form),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["mcp-servers", projectId] });
      setOpen(false);
      navigate(`/p/${projectId}/mcp/${r.server.id}`);
    },
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post(p(projectId, `/mcp-servers/${id}/test`)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["mcp-servers", projectId] }),
  });

  return (
    <>
      <PageHeader
        title="MCP servers"
        subtitle="Register Model Context Protocol servers, inspect their tools, call them by hand, test them directly, or hand them to an LLM target."
        actions={
          canEdit && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setForm(emptyMcpForm());
                setOpen(true);
              }}
            >
              Add server
            </Button>
          )
        }
      />
      {servers.isLoading ? (
        <Loading />
      ) : !servers.data?.length ? (
        <EmptyState
          icon={<Plug className="size-8" />}
          title="No MCP servers yet"
          description="Connect a remote MCP server over HTTP, or run a local one over stdio."
          action={
            canEdit && (
              <Button variant="primary" onClick={() => setOpen(true)}>
                Add your first server
              </Button>
            )
          }
        />
      ) : (
        <div className="card">
          <Table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Transport</th>
                <th>Status</th>
                <th>Tools</th>
                <th>Resources</th>
                <th>Prompts</th>
                <th>Checked</th>
                <th />
              </tr>
            </thead>
            <tbody className="tabular">
              {servers.data.map((s) => (
                <tr key={s.id} className="hover:bg-page">
                  <td>
                    <Link to={`/p/${projectId}/mcp/${s.id}`} className="font-medium hover:text-accent">
                      {s.name}
                    </Link>
                    <div className="max-w-sm truncate font-mono text-xs text-muted">{s.transport === "STDIO" ? `${s.config.command} ${s.config.args.join(" ")}` : s.config.url}</div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Badge>
                        {s.transport === "STDIO" ? <Terminal className="size-3.5" /> : <Globe className="size-3.5" />}
                        {MCP_TRANSPORT_LABELS[s.transport]}
                      </Badge>
                      {s.oauth && (
                        <Badge tone={s.oauth.status === "authorized" ? "accent" : "warn"}>
                          <KeyRound className="size-3.5" />
                          {s.oauth.status === "authorized" ? "OAuth" : "Sign-in needed"}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td title={s.lastError ?? undefined}>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>{s.counts?.tools ?? "—"}</td>
                  <td>{s.counts?.resources ?? "—"}</td>
                  <td>{s.counts?.prompts ?? "—"}</td>
                  <td className="text-xs text-muted">{ago(s.lastCheckedAt)}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={test.isPending && test.variables === s.id} onClick={() => test.mutate(s.id)}>
                      Test
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add MCP server"
        wide
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} disabled={!form.name} onClick={() => create.mutate()}>
              Add & connect
            </Button>
          </>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="text-xs text-muted">Presets:</span>
          {PRESETS.filter((pr) => pr.form.transport !== "STDIO" || isOwner).map((pr) => (
            <button key={pr.label} className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-xs hover:bg-page" onClick={() => setForm({ ...emptyMcpForm(), ...pr.form, config: { ...emptyMcpForm().config, ...pr.form.config, auth: { ...DEFAULT_MCP_AUTH, ...pr.form.config.auth } } })}>
              {pr.label}
            </button>
          ))}
        </div>
        <McpServerFormFields form={form} setForm={setForm} isOwner={isOwner} />
        <ErrorBox error={create.error} className="mt-4" />
      </Modal>
    </>
  );
}
