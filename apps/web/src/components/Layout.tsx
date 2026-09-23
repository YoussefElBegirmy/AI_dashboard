import { useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3, Blocks, ChevronDown, FlaskConical, LayoutDashboard, LogOut, PlayCircle, Plug, Settings, Target } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import pkg from "../../package.json";
import { ThemeToggle } from "./ThemeToggle";
import { clsx } from "./ui";

const nav = [
  { to: "", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "targets", label: "Targets", icon: Target },
  { to: "mcp", label: "MCP servers", icon: Plug },
  { to: "suites", label: "Test suites", icon: FlaskConical },
  { to: "runs", label: "Runs", icon: PlayCircle },
  { to: "metrics", label: "Metrics", icon: BarChart3 },
  { to: "settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const { projectId } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const project = me.data?.projects.find((p) => p.id === projectId);

  const logout = async () => {
    await api.post("/auth/logout");
    qc.clear();
    navigate("/login");
  };

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-surface">
        <Link to="/" className="flex items-center gap-2 px-4 py-4">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-white">
            <Activity className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">AI Eval Dashboard</span>
          <span className="ml-auto rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-text">v{pkg.version}</span>
        </Link>

        <div className="relative px-3">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg border border-line bg-raised px-3 py-2 text-left text-sm hover:bg-page"
          >
            <span className="truncate">
              <span className="block text-[11px] text-muted">Project</span>
              <span className="block truncate font-medium">{project?.name ?? "Select a project"}</span>
            </span>
            <ChevronDown className="size-4 text-muted" />
          </button>
          {open && (
            <div className="absolute inset-x-3 top-full z-30 mt-1 rounded-lg border border-line bg-raised p-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
              {me.data?.projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/p/${p.id}`);
                  }}
                  className={clsx("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-page", p.id === projectId && "font-medium")}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] uppercase text-muted">{p.role}</span>
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              <Link to="/projects" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-page">
                <Blocks className="size-4" /> All projects
              </Link>
            </div>
          )}
        </div>

        <nav className="mt-4 flex-1 space-y-0.5 px-3">
          {projectId &&
            nav.map((n) => (
              <NavLink
                key={n.to}
                to={`/p/${projectId}${n.to ? `/${n.to}` : ""}`}
                end={n.end}
                className={({ isActive }) =>
                  clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition", isActive ? "bg-accent-soft/60 font-medium text-accent-text" : "text-ink-2 hover:bg-ink/5 hover:text-ink")
                }
              >
                <n.icon className="size-4" />
                {n.label}
              </NavLink>
            ))}
        </nav>

        <div className="space-y-2 border-t border-line p-3">
          <ThemeToggle className="flex w-full" showLabels />
          <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{me.data?.user.name}</div>
              <div className="truncate text-xs text-muted">{me.data?.user.email}</div>
            </div>
            <button onClick={logout} className="rounded p-1.5 text-muted hover:bg-ink/5 hover:text-ink" title="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
