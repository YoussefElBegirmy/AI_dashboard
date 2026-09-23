import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, StatusBadge, Table, Textarea } from "../components/ui";
import { api, p } from "../lib/api";
import { useProject } from "../lib/auth";
import { ago } from "../lib/format";
import type { Suite } from "../lib/types";

export function SuitesPage() {
  const { projectId, canEdit } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const suites = useQuery({ queryKey: ["suites", projectId], queryFn: () => api.get<Suite[]>(p(projectId, "/suites")) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const create = useMutation({
    mutationFn: () =>
      api.post<Suite>(p(projectId, "/suites"), {
        ...form,
        evaluators: [
          { id: "correct", name: "Answers correctly", type: "jev_noul", instructions: "Does the output correctly and fully answer the input? If an expected answer is given, is the output consistent with it?", trueDescription: "", falseDescription: "", threshold: 0.5, invert: false, reviewBand: 0.1, weight: 1, required: true },
        ],
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["suites", projectId] });
      navigate(`/p/${projectId}/suites/${s.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Test suites"
        subtitle="Collections of test cases with evaluators. Run a suite against one or more targets to compare them."
        actions={
          canEdit && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
              New suite
            </Button>
          )
        }
      />
      {suites.isLoading ? (
        <Loading />
      ) : !suites.data?.length ? (
        <EmptyState
          icon={<FlaskConical className="size-8" />}
          title="No test suites yet"
          description="A suite holds test cases (input + expected) and evaluators (Jev, LLM judge, assertions)."
          action={
            canEdit && (
              <Button variant="primary" onClick={() => setOpen(true)}>
                Create a suite
              </Button>
            )
          }
        />
      ) : (
        <div className="card">
          <Table>
            <thead>
              <tr>
                <th>Suite</th>
                <th>Cases</th>
                <th>Evaluators</th>
                <th>Runs</th>
                <th>Last run</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {suites.data.map((s) => (
                <tr key={s.id} className="hover:bg-page">
                  <td>
                    <Link to={`/p/${projectId}/suites/${s.id}`} className="font-medium hover:text-accent">
                      {s.name}
                    </Link>
                    {s.description && <div className="max-w-md truncate text-xs text-muted">{s.description}</div>}
                  </td>
                  <td>{s._count?.cases ?? 0}</td>
                  <td>{s.evaluators.length}</td>
                  <td>{s._count?.runs ?? 0}</td>
                  <td>
                    {s.lastRun ? (
                      <Link to={`/p/${projectId}/runs/${s.lastRun.id}`} className="flex items-center gap-2">
                        <StatusBadge status={s.lastRun.status} />
                        <span className="text-xs text-ink-2">
                          {s.lastRun.passed}/{s.lastRun.total} passed · {ago(s.lastRun.createdAt)}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">never</span>
                    )}
                  </td>
                  <td className="text-xs text-muted">{ago(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New test suite"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} disabled={!form.name.trim()} onClick={() => create.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="e.g. Customer support regression" />
          </Field>
          <Field label="Description">
            <Textarea className="font-sans text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">Starts with one Jev yes/no evaluator — change it on the next screen.</p>
          <ErrorBox error={create.error} />
        </div>
      </Modal>
    </>
  );
}
