import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../lib/theme";
import { clsx } from "./ui";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Segmented light / dark / system switch. */
export function ThemeToggle({ className, showLabels }: { className?: string; showLabels?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={clsx("inline-flex rounded-lg border border-line bg-page p-0.5", className)}>
      {OPTIONS.map((o) => {
        const active = preference === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            title={`${o.label} theme`}
            onClick={() => setPreference(o.value)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition",
              active ? "bg-raised text-accent-text shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <o.icon className="size-3.5" />
            {showLabels && o.label}
          </button>
        );
      })}
    </div>
  );
}
