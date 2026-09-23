import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { useMe } from "./lib/auth";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { McpServerDetailPage } from "./pages/McpServerDetail";
import { McpServersPage } from "./pages/McpServers";
import { MetricsPage } from "./pages/Metrics";
import { OverviewPage } from "./pages/Overview";
import { ProjectsPage } from "./pages/Projects";
import { RunComparePage } from "./pages/RunCompare";
import { RunDetailPage } from "./pages/RunDetail";
import { RunsPage } from "./pages/Runs";
import { SettingsPage } from "./pages/Settings";
import { SuiteDetailPage } from "./pages/SuiteDetail";
import { SuitesPage } from "./pages/Suites";
import { TargetEditorPage } from "./pages/TargetEditor";
import { TargetsPage } from "./pages/Targets";

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

function Home() {
  const me = useMe();
  const first = me.data?.projects[0];
  return first ? <Navigate to={`/p/${first.id}`} replace /> : <Navigate to="/projects" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Home />} />
        <Route element={<Layout />}>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/p/:projectId">
            <Route index element={<OverviewPage />} />
            <Route path="targets" element={<TargetsPage />} />
            <Route path="targets/new" element={<TargetEditorPage />} />
            <Route path="targets/:targetId" element={<TargetEditorPage />} />
            <Route path="mcp" element={<McpServersPage />} />
            <Route path="mcp/:serverId" element={<McpServerDetailPage />} />
            <Route path="suites" element={<SuitesPage />} />
            <Route path="suites/:suiteId" element={<SuiteDetailPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/compare" element={<RunComparePage />} />
            <Route path="runs/:runId" element={<RunDetailPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
