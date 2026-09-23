import { AlertTriangle, CheckCircle2, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import type { ToolCallRecord, TraceStep } from "@aieval/shared";
import { ms, usd } from "../lib/format";
import { CodeView } from "./JsonEditor";
import { Badge, clsx, Tabs } from "./ui";

export function ToolCallList({ calls }: { calls: ToolCallRecord[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!calls.length) return <p className="text-sm text-muted">No tool calls.</p>;
  return (
    <ol className="space-y-2">
      {calls.map((c, i) => (
        <li key={i} className="rounded-lg border border-line bg-raised">
          <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setOpen(open === i ? null : i)}>
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight className={clsx("size-4 shrink-0 text-muted transition", open === i && "rotate-90")} />
              <Wrench className="size-3.5 shrink-0 text-muted" />
              <span className="truncate font-mono text-xs font-medium">{c.alias}</span>
              {c.isError ? (
                <Badge tone="bad">
                  <AlertTriangle className="size-3" /> error
                </Badge>
              ) : (
                <Badge tone="good">
                  <CheckCircle2 className="size-3" /> ok
                </Badge>
              )}
            </span>
            <span className="tabular shrink-0 text-xs text-muted">{ms(c.latencyMs)}</span>
          </button>
          {open === i && (
            <div className="grid gap-2 border-t border-line p-3 md:grid-cols-2">
              <div>
                <div className="label">Arguments</div>
                <CodeView value={c.args} maxHeight="16rem" />
              </div>
              <div>
                <div className="label">Result</div>
                <CodeView value={c.result} maxHeight="16rem" />
              </div>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function TraceList({ steps }: { steps: TraceStep[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="relative space-y-2 border-l border-line pl-4">
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span className={clsx("absolute -left-[21px] top-3 size-2.5 rounded-full ring-2 ring-surface", s.error ? "bg-critical" : "bg-good")} />
          <div className="rounded-lg border border-line bg-raised">
            <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setOpen(open === i ? null : i)}>
              <span className="min-w-0">
                <span className="font-mono text-xs font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-muted">{s.targetName}</span>
              </span>
              <span className="tabular shrink-0 text-xs text-muted">
                {ms(s.latencyMs)}
                {s.costUsd ? ` · ${usd(s.costUsd)}` : ""}
              </span>
            </button>
            {s.error && <div className="border-t border-line px-3 py-2 text-xs text-critical">{s.error}</div>}
            {open === i && (
              <div className="grid gap-2 border-t border-line p-3 md:grid-cols-2">
                <div>
                  <div className="label">Input</div>
                  <CodeView value={s.input} maxHeight="14rem" />
                </div>
                <div>
                  <div className="label">Output</div>
                  <CodeView value={s.output} maxHeight="14rem" />
                </div>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Tab = "output" | "json" | "tools" | "trace" | "raw";

export function OutputView({
  output,
  outputJson,
  raw,
  toolCalls,
  trace,
}: {
  output?: string | null;
  outputJson?: unknown;
  raw?: unknown;
  toolCalls?: ToolCallRecord[] | null;
  trace?: TraceStep[] | null;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "output", label: "Output" },
    ...(outputJson !== undefined && outputJson !== null ? [{ id: "json" as Tab, label: "JSON" }] : []),
    ...(toolCalls?.length ? [{ id: "tools" as Tab, label: `Tool calls (${toolCalls.length})` }] : []),
    ...(trace?.length ? [{ id: "trace" as Tab, label: `Trace (${trace.length})` }] : []),
    { id: "raw", label: "Raw" },
  ];
  const [tab, setTab] = useState<Tab>("output");
  const active = tabs.some((t) => t.id === tab) ? tab : "output";
  return (
    <div>
      <Tabs tabs={tabs} value={active} onChange={setTab} />
      {active === "output" && <CodeView value={output ?? ""} />}
      {active === "json" && <CodeView value={outputJson} />}
      {active === "tools" && <ToolCallList calls={toolCalls ?? []} />}
      {active === "trace" && <TraceList steps={trace ?? []} />}
      {active === "raw" && <CodeView value={raw ?? null} />}
    </div>
  );
}
