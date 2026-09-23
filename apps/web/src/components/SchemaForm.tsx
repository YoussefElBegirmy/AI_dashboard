import { JsonEditor } from "./JsonEditor";
import { Field, Input, Select, Textarea, Toggle } from "./ui";

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
  title?: string;
  enum?: unknown[];
  default?: unknown;
  items?: Schema;
  format?: string;
};

const typeOf = (s: Schema) => (Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type) ?? (s.enum ? "string" : s.properties ? "object" : undefined);

export function defaultsFromSchema(schema: Schema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema?.properties ?? {})) {
    if (s.default !== undefined) out[k] = s.default;
  }
  return out;
}

/** Form generated from a JSON Schema's top-level properties (objects/arrays fall back to a JSON editor). */
export function SchemaForm({ schema, value, onChange }: { schema: Schema | undefined; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const props = Object.entries(schema?.properties ?? {});
  const required = new Set(schema?.required ?? []);
  if (!props.length) return <p className="text-sm text-muted">This tool takes no arguments.</p>;

  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {props.map(([key, s]) => {
        const t = typeOf(s);
        const label = (
          <>
            <span className="font-mono">{key}</span>
            {required.has(key) && <span className="text-critical"> *</span>}
            {t && <span className="ml-1 font-normal text-muted">{t}</span>}
          </>
        );
        const hint = s.description;
        const v = value[key];
        if (s.enum) {
          return (
            <Field key={key} label={label} hint={hint}>
              <Select value={v === undefined ? "" : String(v)} onChange={(e) => set(key, e.target.value === "" ? undefined : s.enum!.find((x) => String(x) === e.target.value))}>
                <option value="">—</option>
                {s.enum.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (t === "boolean") {
          return (
            <Field key={key} label={label} hint={hint}>
              <Toggle checked={Boolean(v)} onChange={(b) => set(key, b)} />
            </Field>
          );
        }
        if (t === "number" || t === "integer") {
          return (
            <Field key={key} label={label} hint={hint}>
              <Input type="number" step={t === "integer" ? 1 : "any"} value={v === undefined ? "" : String(v)} onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))} />
            </Field>
          );
        }
        if (t === "object" || t === "array") {
          return (
            <Field key={key} label={label} hint={hint}>
              <JsonEditor value={v ?? (t === "array" ? [] : {})} onChange={(j) => set(key, j)} height="90px" />
            </Field>
          );
        }
        const long = (s.description?.length ?? 0) > 80 || /text|content|body|query|prompt|code/i.test(key);
        return (
          <Field key={key} label={label} hint={hint}>
            {long ? (
              <Textarea rows={3} className="font-sans text-sm" value={v === undefined ? "" : String(v)} onChange={(e) => set(key, e.target.value)} />
            ) : (
              <Input value={v === undefined ? "" : String(v)} onChange={(e) => set(key, e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}
