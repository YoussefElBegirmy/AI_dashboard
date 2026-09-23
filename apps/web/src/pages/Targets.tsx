import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, Globe, Plus, Trash2, Workflow, Wrench, Target as TargetIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TARGET_KIND_LABELS, type TargetKind } from "@aieval/shared";
import { Meter, useTargetColors } from "../components/charts";
import { Badge, Button, Confirm, EmptyState, ErrorBox, Loading, PageHeader, Table } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago, ms, pct, usd } from "../lib/format";
import type { Target } from "../lib/types";

export const KIND_ICONS: Record<TargetKind, typeof Bot> = {
  OPENROUTER_MODEL: Bot,
  HTTP_ENDPOINT: Globe,
  WORKFLOW: Workflow,
  MCP_TOOL: Wrench,
};

export function targetSummary(t: Target): string {
  const c = t.config as Record<string, unknown>;
  switch (t.kind) {
    case "OPENROUTER_MODEL":
      return `${c.model}${(c.mcpServerIds as string[] | undefined)?.length ? ` · ${(c.mcpServerIds as string[]).length} MCP server(s)` : ""}`;
    case "HTTP_ENDPOINT":
      return `${c.method} ${c.url}`;
    case "WORKFLOW":
      return `${(c.steps as unknown[]).length} steps`;
    case "MCP_TOOL":
      return `tool ${c.toolName}`;
  }
}

export function TargetsPage() {
  const { projectId, canEdit } = useProject();
  const colorOf = useTargetColors(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const targets = useQuery({ queryKey: ["targets", projectId], queryFn: () => api.get<Target[]>(p(projectId, "/targets")) });
  const [toDelete, setToDelete] = useState<Target | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(projectId, `/targets/${id}`)),
    onSuccess: () => {
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ["targets", projectId] });
    },
  });
  const dup = useMutation({
    mutationFn: (id: string) => api.post<Target>(p(projectId, `/targets/${id}/duplicate`)),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["targets", projectId] });
      navigate(`/p/${projectId}/targets/${t.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Targets"
        subtitle="Anything a test case can be sent to: OpenRouter models, your HTTP APIs, multi-step workflows and MCP tools."
        actions={
          canEdit && (
            <Link to={`/p/${projectId}/targets/new`}>
              <Button variant="primary" icon={<Plus className="size-4" />}>
                New target
              </Button>
            </Link>
          )
        }
      />
      {targets.isLoading ? (
        <Loading />
      ) : !targets.data?.length ? (
        <EmptyState
          icon={<TargetIcon className="size-8" />}
          title="No targets yet"
          description="Create a target for each API, model or workflow you want to test. You can add new ones any time."
          action={
            canEdit && (
              <Link to={`/p/${projectId}/targets/new`}>
                <Button variant="primary">Create your first target</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="card">
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th className="w-40">Pass rate · 30d</th>
                <th>Avg latency</th>
                <th>Avg cost</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody className="tabular">
              {targets.data.map((t) => {
                const Icon = KIND_ICONS[t.kind];
                return (
                  <tr key={t.id} className="hover:bg-page">
                    <td>
                      <Link to={`/p/${projectId}/targets/${t.id}`} className="flex items-center gap-2 font-medium hover:text-accent">
                        <span className="size-2 rounded-full" style={{ background: colorOf(t.id) }} />
                        {t.name}
                      </Link>
                      <div className="ml-4 max-w-md truncate font-mono text-xs text-muted">{targetSummary(t)}</div>
                    </td>
                    <td>
                      <Badge>
                        <Icon className="size-3.5" />
                        {TARGET_KIND_LABELS[t.kind]}
                      </Badge>
                    </td>
                    <td>
                      {t.stats ? (
                        <div className="flex items-center gap-2">
                          <Meter value={t.stats.passRate} className="w-16" />
                          <span className="text-xs">{pct(t.stats.passRate)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">no runs</span>
                      )}
                    </td>
                    <td className="text-xs">{ms(t.stats?.avgLatencyMs)}</td>
                    <td className="text-xs">{usd(t.stats?.avgCostUsd)}</td>
                    <td className="text-xs text-muted">
                      {ago(t.updatedAt)} · v{t.version}
                    </td>
                    <td className="text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" title="Duplicate" onClick={() => dup.mutate(t.id)}>
                            <Copy className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Delete" onClick={() => setToDelete(t)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
      <Confirm
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        loading={del.isPending}
        title="Delete target"
        message={
          <>
            Delete <b>{toDelete?.name}</b>? Past run results are kept.
            <ErrorBox error={del.error} className="mt-3" />
          </>
        }
      />
    </>
  );
}
