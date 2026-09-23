import { useQuery } from "@tanstack/react-query";
import { Table2, BarChart3 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, p } from "../lib/api";
import { useTheme, type ResolvedTheme } from "../lib/theme";
import type { Target } from "../lib/types";
import { clsx, Table } from "./ui";

/**
 * Categorical palettes, purple-led to match the theme. Validated with the dataviz
 * checks (lightness band, chroma, adjacent CVD separation, normal-vision floor) against
 * each mode's chart surface — the dark column is the same hues stepped for dark, not a flip.
 * Fixed order, never cycled; past 8 series the rest share a muted gray.
 */
const PALETTES: Record<ResolvedTheme, string[]> = {
  light: ["#7c3aed", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#2a78d6", "#e34948"],
  dark: ["#9f7aea", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#3987e5", "#e66767"],
};
/** Status colors are reserved (never used for series) and identical in both modes. */
export const STATUS_COLORS = { PASS: "#0ca30c", FAIL: "#d03b3b", ERROR: "#fab219" } as const;

const INKS: Record<ResolvedTheme, { primary: string; secondary: string; muted: string; grid: string; axis: string; surface: string; cursor: string; other: string }> = {
  light: { primary: "#140f22", secondary: "#574f6b", muted: "#8a8499", grid: "#e8e5ef", axis: "#c9c3d6", surface: "#fdfcfe", cursor: "rgba(20,15,34,0.05)", other: "#8a8499" },
  dark: { primary: "#f3f1f9", secondary: "#c3bdd3", muted: "#8b8499", grid: "#2a2637", axis: "#3b3549", surface: "#16131f", cursor: "rgba(255,255,255,0.06)", other: "#6f6980" },
};

/** Chart colors for the active theme. */
export function useChartTheme() {
  const { resolved } = useTheme();
  return useMemo(() => ({ series: PALETTES[resolved], ink: INKS[resolved] }), [resolved]);
}

/**
 * Color follows the entity: each target keeps the slot of its creation order in the
 * project, so filtering never repaints the survivors.
 */
export function useTargetColors(projectId: string) {
  const targets = useQuery({ queryKey: ["targets", projectId], queryFn: () => api.get<Target[]>(p(projectId, "/targets")) });
  const { series, ink } = useChartTheme();
  return useMemo(() => {
    const ordered = [...(targets.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const map = new Map(ordered.map((t, i) => [t.id, series[i] ?? ink.other]));
    return (id: string | null | undefined) => (id && map.get(id)) || ink.other;
  }, [targets.data, series, ink]);
}

export function ChartCard({
  title,
  subtitle,
  children,
  table,
  className,
  height = 240,
  empty,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  table?: { columns: string[]; rows: ReactNode[][] };
  className?: string;
  height?: number;
  empty?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={clsx("card flex flex-col", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
        </div>
        {table && !empty && (
          <button onClick={() => setShowTable((s) => !s)} className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink" title={showTable ? "Show chart" : "Show table"}>
            {showTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
          </button>
        )}
      </header>
      <div className="flex-1 px-2 pb-3 pt-2">
        {empty ? (
          <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
            No data yet
          </div>
        ) : showTable && table ? (
          <div className="overflow-auto px-2" style={{ maxHeight: height + 40 }}>
            <Table>
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </section>
  );
}

type Fmt = (v: number) => string;

interface TooltipEntry {
  dataKey?: string | number;
  name?: string;
  value?: number | string | null;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({ active, payload, label, fmt, labelFmt }: { active?: boolean; payload?: TooltipEntry[]; label?: unknown; fmt: Fmt; labelFmt?: (l: unknown) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{labelFmt ? labelFmt(label) : String(label)}</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="inline-block size-2 rounded-full" style={{ background: (p.payload?.__color as string) ?? p.color }} />
              {p.name}
            </span>
            <span className="tabular font-medium text-ink">{fmt(Number(p.value))}</span>
          </div>
        ))}
    </div>
  );
}

type Ink = (typeof INKS)["light"];

const axisProps = (ink: Ink) =>
  ({
    tick: { fill: ink.muted, fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: ink.axis },
  }) as const;

const legendText = (ink: Ink) =>
  function LegendText(value: string) {
    return <span style={{ color: ink.secondary, fontSize: 12 }}>{value}</span>;
  };

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

/** Multi-series line over time. One axis only. */
export function TrendChart({ data, series, xKey, fmt, yDomain, xFmt }: { data: Record<string, unknown>[]; series: SeriesDef[]; xKey: string; fmt: Fmt; yDomain?: [number, number]; xFmt?: (v: unknown) => string }) {
  const { series: SERIES, ink: INK } = useChartTheme();
  const axis = axisProps(INK);
  const LegendText = legendText(INK);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey={xKey} {...axis} tickFormatter={xFmt} minTickGap={24} />
        <YAxis {...axis} axisLine={false} tickFormatter={fmt} domain={yDomain ?? ["auto", "auto"]} width={48} />
        <Tooltip content={<ChartTooltip fmt={fmt} labelFmt={xFmt} />} cursor={{ stroke: INK.axis, strokeWidth: 1 }} />
        {series.length > 1 && <Legend iconType="plainline" formatter={LegendText} itemSorter={null} wrapperStyle={{ paddingTop: 4 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={data.length <= 12 ? { r: 4, fill: s.color, stroke: INK.surface, strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: s.color, stroke: INK.surface, strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for comparing categories; color per row (entity) or single slot. */
export function HBarChart({ data, fmt, max, labelWidth = 120 }: { data: { label: string; value: number | null; color?: string }[]; fmt: Fmt; max?: number; labelWidth?: number }) {
  const { series: SERIES, ink: INK } = useChartTheme();
  const axis = axisProps(INK);
  const LegendText = legendText(INK);
  const rows = data.map((d) => ({ ...d, value: d.value ?? 0, __color: d.color ?? SERIES[0] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" {...axis} tickFormatter={fmt} domain={[0, max ?? "auto"]} />
        <YAxis type="category" dataKey="label" {...axis} axisLine={false} width={labelWidth} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
        <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ fill: INK.cursor }} />
        <Bar dataKey="value" name="Value" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} label={{ position: "right", fill: INK.secondary, fontSize: 11, formatter: (v: unknown) => fmt(Number(v)) }}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.__color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical columns (single series), e.g. histograms. */
export function ColumnChart({ data, xKey, yKey, fmt, name, color }: { data: Record<string, unknown>[]; xKey: string; yKey: string; fmt: Fmt; name: string; color?: string }) {
  const { series: SERIES, ink: INK } = useChartTheme();
  const axis = axisProps(INK);
  const LegendText = legendText(INK);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey={xKey} {...axis} interval={0} tick={{ fill: INK.muted, fontSize: 10 }} />
        <YAxis {...axis} axisLine={false} tickFormatter={fmt} width={40} allowDecimals={false} />
        <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ fill: INK.cursor }} />
        <Bar dataKey={yKey} name={name} fill={color ?? SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Grouped horizontal bars for 2–3 measures of the same unit (e.g. p50/p95 latency). */
export function GroupedHBarChart({ data, series, fmt, labelWidth = 120 }: { data: Record<string, unknown>[]; series: SeriesDef[]; fmt: Fmt; labelWidth?: number }) {
  const { series: SERIES, ink: INK } = useChartTheme();
  const axis = axisProps(INK);
  const LegendText = legendText(INK);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 0 }} barGap={2} barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" {...axis} tickFormatter={fmt} />
        <YAxis type="category" dataKey="label" {...axis} axisLine={false} width={labelWidth} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
        <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ fill: INK.cursor }} />
        <Legend iconType="square" formatter={LegendText} itemSorter={null} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Pass / fail / error share per row. Status colors (with a labelled legend). 2px surface gap between segments. */
export function StatusStackChart({ data, labelWidth = 120 }: { data: { label: string; PASS: number; FAIL: number; ERROR: number }[]; labelWidth?: number }) {
  const { series: SERIES, ink: INK } = useChartTheme();
  const axis = axisProps(INK);
  const LegendText = legendText(INK);
  const fmt = (v: number) => String(v);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" {...axis} allowDecimals={false} />
        <YAxis type="category" dataKey="label" {...axis} axisLine={false} width={labelWidth} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
        <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ fill: INK.cursor }} />
        <Legend iconType="square" formatter={LegendText} itemSorter={null} />
        <Bar dataKey="PASS" name="✓ Pass" stackId="s" fill={STATUS_COLORS.PASS} stroke={INK.surface} strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="FAIL" name="✕ Fail" stackId="s" fill={STATUS_COLORS.FAIL} stroke={INK.surface} strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="ERROR" name="⚠ Error" stackId="s" fill={STATUS_COLORS.ERROR} stroke={INK.surface} strokeWidth={2} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Thin progress meter for pass rate cells. */
export function Meter({ value, className }: { value: number | null; className?: string }) {
  const v = value ?? 0;
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-accent-soft", className)}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} />
    </div>
  );
}
