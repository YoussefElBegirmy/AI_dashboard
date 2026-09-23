import { json } from "@codemirror/lang-json";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../lib/theme";
import { clsx } from "./ui";

// Surfaces follow the app's theme tokens; syntax colors come from CodeMirror's light/dark preset.
const chrome = EditorView.theme({
  "&": { fontSize: "12.5px", backgroundColor: "var(--raised) !important" },
  ".cm-gutters": { backgroundColor: "var(--page) !important", borderRight: "1px solid var(--grid)", color: "var(--muted)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--accent) 7%, transparent)" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--ink)" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--accent) 25%, transparent) !important" },
  "&.cm-focused": { outline: "none" },
});

/**
 * JSON editor bound to a parsed value. Invalid JSON is kept locally (and flagged)
 * until it parses, so typing never loses characters.
 */
export function JsonEditor({
  value,
  onChange,
  height = "160px",
  readOnly,
  className,
  onValidityChange,
}: {
  value: unknown;
  onChange?: (v: unknown) => void;
  height?: string;
  readOnly?: boolean;
  className?: string;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef<string>(JSON.stringify(value ?? null));
  const { resolved } = useTheme();

  useEffect(() => {
    const incoming = JSON.stringify(value ?? null);
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setText(JSON.stringify(value ?? null, null, 2));
      setError(null);
    }
  }, [value]);

  return (
    <div className={clsx("overflow-hidden rounded-lg border", error ? "border-critical/60" : "border-line", className)}>
      <CodeMirror
        value={text}
        height={height}
        readOnly={readOnly}
        editable={!readOnly}
        theme={resolved}
        basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: !readOnly, autocompletion: false }}
        extensions={[json(), chrome, EditorView.lineWrapping]}
        onChange={(t) => {
          setText(t);
          try {
            const parsed = t.trim() === "" ? null : JSON.parse(t);
            setError(null);
            lastEmitted.current = JSON.stringify(parsed);
            onValidityChange?.(true);
            onChange?.(parsed);
          } catch (e) {
            setError((e as Error).message);
            onValidityChange?.(false);
          }
        }}
      />
      {error && <div className="border-t border-critical/30 bg-critical/5 px-3 py-1 text-xs text-critical">{error}</div>}
    </div>
  );
}

export function CodeView({ value, className, maxHeight = "24rem" }: { value: unknown; className?: string; maxHeight?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className={clsx("overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-page p-3 font-mono text-[12px] leading-relaxed text-ink", className)} style={{ maxHeight }}>
      {text === undefined ? "—" : text}
    </pre>
  );
}
