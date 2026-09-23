import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Confirm, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject, useRefreshMe } from "../lib/auth";
import { ago } from "../lib/format";

type Tab = "secrets" | "members" | "tokens" | "general";

const WELL_KNOWN = [
  { name: "OPENROUTER_API_KEY", hint: "Used by OpenRouter model targets and the LLM judge" },
  { name: "TYPESAFE_API_KEY", hint: "Used by Jev evaluators (TypeSafe System One)" },
];

function SecretsTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.get<{ secrets: { id: string; name: string; preview: string; updatedAt: string }[]; envFallbacks: string[] }>(p(projectId, "/secrets")),
  });
  const [editing, setEditing] = useState<{ name: string; value: string; isNew: boolean } | null>(null);
  const save = useMutation({
    mutationFn: () => api.put(p(projectId, `/secrets/${editing!.name}`), { value: editing!.value }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["secrets", projectId] });
    },
  });
  const del = useMutation({ mutationFn: (name: string) => api.del(p(projectId, `/secrets/${name}`)), onSuccess: () => qc.invalidateQueries({ queryKey: ["secrets", projectId] }) });
  if (secrets.isLoading) return <Loading />;
  const names = new Set(secrets.data?.secrets.map((s) => s.name));
  const missing = WELL_KNOWN.filter((w) => !names.has(w.name));

  return (
    <Card
      title="Secrets"
      actions={
        canEdit && (
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ name: "", value: "", isNew: true })}>
            Add secret
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      <p className="border-b border-line px-4 py-3 text-xs text-ink-2">
        Encrypted at rest (AES-256-GCM). Reference them in targets as <code className="code">{"{{secrets.NAME}}"}</code>. Values are never shown again after saving.
      </p>
      {missing.length > 0 && (
        <div className="space-y-2 border-b border-line px-4 py-3">
          {missing.map((m) => (
            <div key={m.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-line px-3 py-2">
              <div>
                <span className="font-mono text-xs font-medium">{m.name}</span>
                <span className="ml-2 text-xs text-muted">{m.hint}</span>
                {secrets.data?.envFallbacks.includes(m.name) && (
                  <Badge tone="good" className="ml-2">
                    set via server env
                  </Badge>
                )}
              </div>
              {canEdit && (
                <Button size="sm" onClick={() => setEditing({ name: m.name, value: "", isNew: true })}>
                  Set
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {secrets.data?.secrets.map((s) => (
            <tr key={s.id}>
              <td className="font-mono text-xs font-medium">{s.name}</td>
              <td className="font-mono text-xs text-muted">{s.preview}</td>
              <td className="text-xs text-muted">{ago(s.updatedAt)}</td>
              <td className="text-right">
                {canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ name: s.name, value: "", isNew: false })}>
                      Replace
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(s.name)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {!secrets.data?.secrets.length && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-sm text-muted">
                No secrets yet.
              </td>
            </tr>
          )}
        </tbody>
      </Table>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? "Add secret" : `Replace ${editing?.name}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={!editing?.name || !editing?.value} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Name" hint="Letters, digits and underscores">
              <Input className="font-mono" value={editing.name} disabled={!editing.isNew} onChange={(e) => setEditing({ ...editing, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} />
            </Field>
            <Field label="Value">
              <Textarea rows={3} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} autoFocus={!editing.isNew} />
            </Field>
            <ErrorBox error={save.error} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface MembersData {
  members: { id: string; role: string; user: { id: string; email: string; name: string } }[];
  invites: { id: string; email: string; role: string; link: string; expiresAt: string }[];
}

function MembersTab({ projectId, isOwner, userId }: { projectId: string; isOwner: boolean; userId?: string }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["members", projectId], queryFn: () => api.get<MembersData>(p(projectId, "/members")) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [link, setLink] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["members", projectId] });
  const add = useMutation({
    mutationFn: () => api.post<{ added: boolean; invite?: { link: string } }>(p(projectId, "/members"), { email, role }),
    onSuccess: (r) => {
      setEmail("");
      setLink(r.invite?.link ?? null);
      invalidate();
    },
  });
  const setMemberRole = useMutation({ mutationFn: (v: { id: string; role: string }) => api.patch(p(projectId, `/members/${v.id}`), { role: v.role }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.del(p(projectId, `/members/${id}`)), onSuccess: invalidate });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(p(projectId, `/invites/${id}`)), onSuccess: invalidate });
  if (data.isLoading) return <Loading />;

  return (
    <div className="space-y-6">
      {isOwner && (
        <Card title="Invite a teammate">
          <div className="flex flex-wrap gap-2">
            <Input type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
            <Select className="w-36" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="VIEWER">Viewer</option>
              <option value="EDITOR">Editor</option>
              <option value="OWNER">Owner</option>
            </Select>
            <Button variant="primary" loading={add.isPending} disabled={!email} onClick={() => add.mutate()}>
              Invite
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">Existing users are added right away; others get an invite link (valid 14 days). Viewers read only; editors manage targets, suites and runs; owners also manage members and stdio MCP servers.</p>
          <ErrorBox error={add.error} className="mt-2" />
          {link && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-page p-2">
              <code className="flex-1 truncate font-mono text-xs">{link}</code>
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(link)}>
                Copy
              </Button>
            </div>
          )}
        </Card>
      )}
      <Card title="Members" bodyClassName="p-0">
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.data?.members.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">
                  {m.user.name} {m.user.id === userId && <Badge>you</Badge>}
                </td>
                <td className="text-ink-2">{m.user.email}</td>
                <td>
                  {isOwner ? (
                    <Select className="h-8 w-32 py-1 text-xs" value={m.role} onChange={(e) => setMemberRole.mutate({ id: m.id, role: e.target.value })}>
                      <option value="VIEWER">Viewer</option>
                      <option value="EDITOR">Editor</option>
                      <option value="OWNER">Owner</option>
                    </Select>
                  ) : (
                    <Badge>{m.role.toLowerCase()}</Badge>
                  )}
                </td>
                <td className="text-right">
                  {(isOwner || m.user.id === userId) && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.id)}>
                      {m.user.id === userId ? "Leave" : <Trash2 className="size-3.5" />}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <ErrorBox error={setMemberRole.error ?? remove.error} className="m-3" />
      </Card>
      {isOwner && Boolean(data.data?.invites.length) && (
        <Card title="Pending invites" bodyClassName="p-0">
          <Table>
            <tbody>
              {data.data!.invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>
                    <Badge>{i.role.toLowerCase()}</Badge>
                  </td>
                  <td className="text-xs text-muted">expires {ago(i.expiresAt).replace(" ago", "")}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(i.link)}>
                      Link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function TokensTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens", projectId], queryFn: () => api.get<{ id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string }[]>(p(projectId, "/tokens")) });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ token: string }>(p(projectId, "/tokens"), { name }),
    onSuccess: (r) => {
      setCreated(r.token);
      setName("");
      qc.invalidateQueries({ queryKey: ["tokens", projectId] });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(p(projectId, `/tokens/${id}`)), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens", projectId] }) });
  const origin = window.location.origin;

  return (
    <div className="space-y-6">
      <Card title="API tokens" bodyClassName="p-0">
        <p className="border-b border-line px-4 py-3 text-xs text-ink-2">Personal tokens scoped to this project. Use them from CI to start suite runs and wait for the result.</p>
        {canEdit && (
          <div className="flex gap-2 border-b border-line px-4 py-3">
            <Input placeholder="Token name, e.g. GitHub Actions" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            <Button variant="primary" icon={<KeyRound className="size-4" />} loading={create.isPending} disabled={!name} onClick={() => create.mutate()}>
              Create token
            </Button>
          </div>
        )}
        {created && (
          <div className="border-b border-line bg-good/5 px-4 py-3">
            <div className="mb-1 text-xs font-medium text-good-text">Copy this token now — it will not be shown again.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-raised px-2 py-1 font-mono text-xs">{created}</code>
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(created)}>
                Copy
              </Button>
            </div>
          </div>
        )}
        <Table>
          <tbody>
            {tokens.data?.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.name}</td>
                <td className="font-mono text-xs text-muted">{t.prefix}…</td>
                <td className="text-xs text-muted">created {ago(t.createdAt)}</td>
                <td className="text-xs text-muted">{t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : "never used"}</td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(t.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {!tokens.data?.length && (
              <tr>
                <td className="py-6 text-center text-sm text-muted">No tokens.</td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
      <Card title="CI example">
        <pre className="overflow-x-auto rounded-lg bg-page p-3 font-mono text-[11px] leading-relaxed text-ink-2">{`RUN=$(curl -s -X POST -H "Authorization: Bearer $AIEVAL_TOKEN" \\
  -H "Content-Type: application/json" -d '{}' \\
  ${origin}/api/v1/suites/<SUITE_ID>/runs | jq -r .id)

while :; do
  R=$(curl -s -H "Authorization: Bearer $AIEVAL_TOKEN" ${origin}/api/v1/runs/$RUN)
  [ "$(echo $R | jq .finished)" = "true" ] && break; sleep 5
done
echo $R | jq
[ "$(echo $R | jq '.failed + .errored')" = "0" ]   # fail the build on any failure`}</pre>
      </Card>
    </div>
  );
}

function GeneralTab({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const refresh = useRefreshMe();
  const navigate = useNavigate();
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => api.get<{ name: string; description: string }>(p(projectId)) });
  const [form, setForm] = useState({ name: "", description: "" });
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (project.data) setForm({ name: project.data.name, description: project.data.description });
  }, [project.data]);
  const save = useMutation({
    mutationFn: () => api.patch(p(projectId), form),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(p(projectId)),
    onSuccess: async () => {
      await refresh();
      navigate("/");
    },
  });
  return (
    <div className="space-y-6">
      <Card title="Project">
        <fieldset disabled={!isOwner} className="max-w-lg space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea className="font-sans text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          {isOwner && (
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          )}
          <ErrorBox error={save.error} />
        </fieldset>
      </Card>
      {isOwner && (
        <Card title="Danger zone">
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
            Delete project
          </Button>
        </Card>
      )}
      <Confirm open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete project" message="This permanently deletes all targets, MCP servers, suites, runs and secrets in this project." />
    </div>
  );
}

export function SettingsPage() {
  const { projectId, canEdit, isOwner, user } = useProject();
  const [tab, setTab] = useState<Tab>("secrets");
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs
        tabs={[
          { id: "secrets", label: "Secrets" },
          { id: "members", label: "Members" },
          { id: "tokens", label: "API tokens" },
          { id: "general", label: "General" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "secrets" && <SecretsTab projectId={projectId} canEdit={canEdit} />}
      {tab === "members" && <MembersTab projectId={projectId} isOwner={isOwner} userId={user?.id} />}
      {tab === "tokens" && <TokensTab projectId={projectId} canEdit={canEdit} />}
      {tab === "general" && <GeneralTab projectId={projectId} isOwner={isOwner} />}
    </>
  );
}
