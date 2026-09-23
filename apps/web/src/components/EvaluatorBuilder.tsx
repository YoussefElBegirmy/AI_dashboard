import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { defaultEvaluator, EVALUATOR_LABELS, type Evaluator, type EvaluatorType } from "@aieval/shared";
import { uid } from "../lib/format";
import { JsonEditor } from "./JsonEditor";
import { Badge, Button, clsx, Field, Input, KeyValueEditor, Select, Textarea, Toggle } from "./ui";

const FAMILIES: { family: string; description: string; types: EvaluatorType[] }[] = [
  { family: "Jev (TypeSafe)", description: "Fast typed judgments with probabilities", types: ["jev_noul", "jev_score", "jev_choice"] },
  { family: "LLM judge", description: "OpenRouter model with a rubric; explains its reasoning", types: ["llm_judge"] },
  { family: "Assertions", description: "Deterministic checks", types: ["contains", "not_contains", "equals", "regex", "json_schema", "json_path", "status_code", "max_latency", "max_cost", "tool_called", "tool_not_called"] },
];

type Patch = Record<string, unknown>;

function num(v: string) {
  return v === "" ? 0 : Number(v);
}

function EvaluatorFields({ e, set }: { e: Evaluator; set: (p: Patch) => void }) {
  switch (e.type) {
    case "jev_noul":
      return (
        <>
          <Field label="Yes/no question" hint="Jev sees input, expected, output and tool_calls.">
            <Textarea rows={2} className="font-sans text-sm" value={e.instructions} onChange={(ev) => set({ instructions: ev.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label='"Yes" means (optional)'>
              <Input value={e.trueDescription} onChange={(ev) => set({ trueDescription: ev.target.value })} />
            </Field>
            <Field label='"No" means (optional)'>
              <Input value={e.falseDescription} onChange={(ev) => set({ falseDescription: ev.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pass threshold" hint="P(yes) needed">
              <Input type="number" step="0.05" min={0} max={1} value={e.threshold} onChange={(ev) => set({ threshold: num(ev.target.value) })} />
            </Field>
            <Field label="Review band" hint="±band around 0.5 flags for review">
              <Input type="number" step="0.05" min={0} max={0.5} value={e.reviewBand} onChange={(ev) => set({ reviewBand: num(ev.target.value) })} />
            </Field>
            <div className="pt-6">
              <Toggle checked={e.invert} onChange={(invert) => set({ invert })} label='Pass on "no"' />
            </div>
          </div>
        </>
      );
    case "jev_score":
      return (
        <>
          <Field label="What to rate">
            <Textarea rows={2} className="font-sans text-sm" value={e.instructions} onChange={(ev) => set({ instructions: ev.target.value })} />
          </Field>
          <Field label="Rubric levels (worst → best, 2–10)">
            <div className="space-y-1.5">
              {e.levels.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="tabular w-5 text-right text-xs text-muted">{i}</span>
                  <Input value={l} onChange={(ev) => set({ levels: e.levels.map((x, j) => (j === i ? ev.target.value : x)) })} />
                  <Button size="sm" variant="ghost" disabled={e.levels.length <= 2} onClick={() => set({ levels: e.levels.filter((_, j) => j !== i) })}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              {e.levels.length < 10 && (
                <Button size="sm" variant="ghost" onClick={() => set({ levels: [...e.levels, ""] })}>
                  + Level
                </Button>
              )}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pass threshold" hint="Normalised score (score ÷ top level)">
              <Input type="number" step="0.05" min={0} max={1} value={e.threshold} onChange={(ev) => set({ threshold: num(ev.target.value) })} />
            </Field>
            <Field label="Flag for review below confidence">
              <Input type="number" step="0.05" min={0} max={1} value={e.reviewBelowConfidence} onChange={(ev) => set({ reviewBelowConfidence: num(ev.target.value) })} />
            </Field>
          </div>
        </>
      );
    case "jev_choice":
      return (
        <>
          <Field label="Question">
            <Textarea rows={2} className="font-sans text-sm" value={e.instructions} onChange={(ev) => set({ instructions: ev.target.value })} />
          </Field>
          <Field label="Options (label → description)">
            <KeyValueEditor value={e.options} onChange={(options) => set({ options, passOptions: e.passOptions.filter((o) => o in options) })} keyPlaceholder="label" valuePlaceholder="description" />
          </Field>
          <Field label="Passing options">
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(e.options).map((o) => {
                const on = e.passOptions.includes(o);
                return (
                  <button key={o} onClick={() => set({ passOptions: on ? e.passOptions.filter((x) => x !== o) : [...e.passOptions, o] })} className={clsx("rounded-md border px-2 py-0.5 text-xs", on ? "border-good bg-good/10 text-good-text" : "border-line bg-raised text-ink-2")}>
                    {on ? "✓ " : ""}
                    {o}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Flag for review below confidence" className="w-64">
            <Input type="number" step="0.05" min={0} max={1} value={e.reviewBelowConfidence} onChange={(ev) => set({ reviewBelowConfidence: num(ev.target.value) })} />
          </Field>
        </>
      );
    case "llm_judge":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Judge model (OpenRouter)">
              <Input className="font-mono" value={e.model} onChange={(ev) => set({ model: ev.target.value })} />
            </Field>
            <Field label="Pass threshold (0–1)">
              <Input type="number" step="0.05" min={0} max={1} value={e.threshold} onChange={(ev) => set({ threshold: num(ev.target.value) })} />
            </Field>
          </div>
          <Field label="Rubric">
            <Textarea rows={3} className="font-sans text-sm" value={e.rubric} onChange={(ev) => set({ rubric: ev.target.value })} />
          </Field>
        </>
      );
    case "equals":
    case "contains":
    case "not_contains":
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Value" hint="Templates allowed, e.g. {{expected.answer}}">
            <Input value={e.value} onChange={(ev) => set({ value: ev.target.value })} />
          </Field>
          <div className="flex flex-col gap-2 pt-6">
            <Toggle checked={e.caseInsensitive} onChange={(caseInsensitive) => set({ caseInsensitive })} label="Ignore case" />
          </div>
        </div>
      );
    case "regex":
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Pattern">
            <Input className="font-mono" value={e.pattern} onChange={(ev) => set({ pattern: ev.target.value })} />
          </Field>
          <Field label="Flags">
            <Input className="font-mono" value={e.flags} onChange={(ev) => set({ flags: ev.target.value })} placeholder="i" />
          </Field>
        </div>
      );
    case "json_schema":
      return (
        <Field label="JSON Schema the output must match">
          <JsonEditor value={e.schema} onChange={(schema) => set({ schema: schema ?? {} })} height="140px" />
        </Field>
      );
    case "json_path":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="JSONPath">
            <Input className="font-mono" value={e.path} onChange={(ev) => set({ path: ev.target.value })} />
          </Field>
          <Field label="Mode">
            <Select value={e.mode} onChange={(ev) => set({ mode: ev.target.value })}>
              <option value="exists">exists</option>
              <option value="equals">equals</option>
              <option value="contains">contains</option>
            </Select>
          </Field>
          {e.mode !== "exists" && (
            <Field label="Value">
              <Input value={e.value} onChange={(ev) => set({ value: ev.target.value })} />
            </Field>
          )}
        </div>
      );
    case "status_code":
      return (
        <Field label="Allowed status codes" hint="Comma separated">
          <Input value={e.codes.join(", ")} onChange={(ev) => set({ codes: ev.target.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)) })} />
        </Field>
      );
    case "max_latency":
      return (
        <Field label="Max latency (ms)" className="w-48">
          <Input type="number" value={e.ms} onChange={(ev) => set({ ms: num(ev.target.value) })} />
        </Field>
      );
    case "max_cost":
      return (
        <Field label="Max cost (USD)" className="w-48">
          <Input type="number" step="0.001" value={e.usd} onChange={(ev) => set({ usd: num(ev.target.value) })} />
        </Field>
      );
    case "tool_called":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tool name" hint="tool or server__tool">
              <Input className="font-mono" value={e.tool} onChange={(ev) => set({ tool: ev.target.value })} />
            </Field>
            <Field label="Min times">
              <Input type="number" min={1} value={e.minTimes} onChange={(ev) => set({ minTimes: Math.max(1, num(ev.target.value)) })} />
            </Field>
          </div>
          <Field label="Arguments must contain (optional)">
            <JsonEditor value={e.argsContain} onChange={(argsContain) => set({ argsContain: argsContain ?? {} })} height="80px" />
          </Field>
        </>
      );
    case "tool_not_called":
      return (
        <Field label="Tool name">
          <Input className="font-mono" value={e.tool} onChange={(ev) => set({ tool: ev.target.value })} />
        </Field>
      );
  }
}

export function EvaluatorBuilder({ value, onChange, readOnly }: { value: Evaluator[]; onChange: (v: Evaluator[]) => void; readOnly?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const update = (id: string, patch: Patch) => onChange(value.map((e) => (e.id === id ? ({ ...e, ...patch } as Evaluator) : e)));
  const add = (type: EvaluatorType) => {
    const e = defaultEvaluator(type, uid());
    onChange([...value, e]);
    setOpen(e.id);
    setPicker(false);
  };

  return (
    <div className="space-y-2">
      {value.map((e) => {
        const meta = EVALUATOR_LABELS[e.type];
        const isOpen = open === e.id;
        return (
          <div key={e.id} className="rounded-lg border border-line bg-raised">
            <div className="flex items-center gap-2 px-3 py-2">
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(isOpen ? null : e.id)}>
                {isOpen ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                <Badge tone={meta.family === "Jev" ? "accent" : meta.family === "LLM judge" ? "warn" : "neutral"}>{meta.label}</Badge>
                <span className="truncate text-sm font-medium">{e.name}</span>
                {!e.required && <span className="text-xs text-muted">(informational)</span>}
                {e.weight !== 1 && <span className="text-xs text-muted">×{e.weight}</span>}
              </button>
              {!readOnly && (
                <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((x) => x.id !== e.id))}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            {isOpen && (
              <fieldset disabled={readOnly} className="space-y-3 border-t border-line p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto]">
                  <Field label="Name">
                    <Input value={e.name} onChange={(ev) => update(e.id, { name: ev.target.value })} />
                  </Field>
                  <Field label="Weight">
                    <Input type="number" step="0.5" min={0} value={e.weight} onChange={(ev) => update(e.id, { weight: num(ev.target.value) })} />
                  </Field>
                  <div className="pt-6">
                    <Toggle checked={e.required} onChange={(required) => update(e.id, { required })} label="Must pass" />
                  </div>
                </div>
                <EvaluatorFields e={e} set={(p) => update(e.id, p)} />
              </fieldset>
            )}
          </div>
        );
      })}
      {!value.length && <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">No evaluators. Add Jev checks, an LLM judge or assertions.</p>}
      {!readOnly &&
        (picker ? (
          <div className="grid gap-3 rounded-lg border border-line bg-page p-3 md:grid-cols-3">
            {FAMILIES.map((f) => (
              <div key={f.family}>
                <div className="text-xs font-semibold">{f.family}</div>
                <div className="mb-2 text-xs text-muted">{f.description}</div>
                <div className="flex flex-wrap gap-1.5">
                  {f.types.map((t) => (
                    <button key={t} onClick={() => add(t)} className="rounded-md border border-line bg-raised px-2 py-1 text-xs hover:border-accent hover:text-accent">
                      {EVALUATOR_LABELS[t].label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="md:col-span-3">
              <Button size="sm" variant="ghost" onClick={() => setPicker(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setPicker(true)}>
            Add evaluator
          </Button>
        ))}
    </div>
  );
}
