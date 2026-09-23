import { useMutation, useQuery } from "@tanstack/react-query";
import { Blocks, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useRefreshMe } from "../lib/auth";
import type { ProjectSummary } from "../lib/types";

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectSummary[]>("/projects") });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const refresh = useRefreshMe();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.post<ProjectSummary>("/projects", { name }),
    onSuccess: async (p) => {
      await refresh();
      navigate(`/p/${p.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Each project has its own targets, MCP servers, suites, secrets and members."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            New project
          </Button>
        }
      />
      {projects.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data?.map((p) => (
            <Link key={p.id} to={`/p/${p.id}`} className="card block p-5 transition hover:border-accent/40 hover:shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Blocks className="size-4 text-muted" />
                  <span className="font-semibold">{p.name}</span>
                </div>
                <Badge>{p.role.toLowerCase()}</Badge>
              </div>
              {p.description && <p className="mt-2 text-sm text-ink-2">{p.description}</p>}
              <div className="mt-4 flex gap-4 text-xs text-muted">
                <span>{p._count?.targets ?? 0} targets</span>
                <span>{p._count?.suites ?? 0} suites</span>
                <span>{p._count?.mcpServers ?? 0} MCP</span>
                <span>{p._count?.members ?? 0} members</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New project"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Support bot" />
        </Field>
        <ErrorBox error={create.error} className="mt-3" />
      </Modal>
    </>
  );
}
