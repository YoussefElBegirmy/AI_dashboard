import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, X, XCircle, CircleHelp, Ban, Clock } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export { clsx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover border-transparent",
  secondary: "bg-raised text-ink border-line hover:bg-page",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-ink/5",
  danger: "bg-raised text-critical border-line hover:bg-critical/5",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx("input", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx("input min-h-20 font-mono text-[13px] leading-relaxed", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx("input pr-8", className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("inline-flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-5 w-9 rounded-full transition", checked ? "bg-accent" : "bg-axis")}
      >
        <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition", checked ? "left-4.5" : "left-0.5")} />
      </button>
      {label && <span className="text-ink-2">{label}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-1 text-xs text-muted">{back}</div>}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "bad" | "warn"; className?: string }) {
  const tones = {
    neutral: "bg-ink/5 text-ink-2",
    accent: "bg-accent-soft text-accent-text",
    good: "bg-good/10 text-good-text",
    bad: "bg-critical/10 text-critical",
    warn: "bg-warning/20 text-warning-text",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

/** Status always carries icon + label, never color alone. */
export function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const map: Record<string, { tone: "neutral" | "accent" | "good" | "bad" | "warn"; icon: ReactNode; label: string }> = {
    PASS: { tone: "good", icon: <CheckCircle2 className="size-3.5" />, label: "Pass" },
    FAIL: { tone: "bad", icon: <XCircle className="size-3.5" />, label: "Fail" },
    ERROR: { tone: "warn", icon: <AlertTriangle className="size-3.5" />, label: "Error" },
    PENDING: { tone: "neutral", icon: <CircleDashed className="size-3.5" />, label: "Pending" },
    QUEUED: { tone: "neutral", icon: <Clock className="size-3.5" />, label: "Queued" },
    RUNNING: { tone: "accent", icon: <Loader2 className="size-3.5 animate-spin" />, label: "Running" },
    COMPLETED: { tone: "good", icon: <CheckCircle2 className="size-3.5" />, label: "Completed" },
    FAILED: { tone: "bad", icon: <XCircle className="size-3.5" />, label: "Failed" },
    CANCELLED: { tone: "neutral", icon: <Ban className="size-3.5" />, label: "Cancelled" },
    connected: { tone: "good", icon: <CheckCircle2 className="size-3.5" />, label: "Connected" },
    error: { tone: "bad", icon: <XCircle className="size-3.5" />, label: "Error" },
    unknown: { tone: "neutral", icon: <CircleHelp className="size-3.5" />, label: "Unknown" },
  };
  const m = map[status] ?? map.unknown;
  return (
    <Badge tone={m.tone}>
      {m.icon}
      {!small && m.label}
    </Badge>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-sm text-critical", className)}>
      <XCircle className="mt-0.5 size-4 shrink-0" />
      <span className="whitespace-pre-wrap break-words">{msg}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx("card w-full shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-ink/5" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 text-sm font-semibold">{title}</div>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-ink/5" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            value === t.id ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-ink-2 [&_tr:last-child_td]:border-b-0">
        {children}
      </table>
    </div>
  );
}

/** Editable list of string key/value pairs (headers, env, query). */
export function KeyValueEditor({ value, onChange, keyPlaceholder = "Name", valuePlaceholder = "Value" }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyPlaceholder?: string; valuePlaceholder?: string }) {
  const entries = Object.entries(value);
  const set = (rows: [string, string][]) => onChange(Object.fromEntries(rows));
  return (
    <div className="space-y-2">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <Input value={k} placeholder={keyPlaceholder} className="w-2/5 font-mono text-xs" onChange={(e) => set(entries.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))} />
          <Input value={v} placeholder={valuePlaceholder} className="flex-1 font-mono text-xs" onChange={(e) => set(entries.map((row, j) => (j === i ? [row[0], e.target.value] : row)))} />
          <Button variant="ghost" size="sm" className="h-9" onClick={() => set(entries.filter((_, j) => j !== i))} aria-label="Remove">
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => set([...entries, ["", ""]])}>
        + Add
      </Button>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmLabel = "Delete", loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="bg-critical hover:bg-critical/90" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{message}</div>
    </Modal>
  );
}
