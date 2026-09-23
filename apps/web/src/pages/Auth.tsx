import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle";
import { Button, ErrorBox, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useMe, useRefreshMe } from "../lib/auth";

function Shell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-h-full items-center justify-center p-6">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
            <Activity className="size-4" />
          </span>
          <span className="font-semibold tracking-tight">AI Eval Dashboard</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe();
  const refresh = useRefreshMe();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<{ needsSetup: boolean; allowSignup: boolean }>("/auth/status") });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  if (me.data) return <Navigate to={params.get("next") ?? "/"} replace />;
  if (status.data?.needsSetup) return <Navigate to="/register" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      await refresh();
      navigate(params.get("next") ?? "/");
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell title="Sign in" subtitle="Test and evaluate your AI endpoints, workflows and MCP tools.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Sign in
        </Button>
        {status.data?.allowSignup && (
          <p className="text-center text-sm text-ink-2">
            No account?{" "}
            <Link to="/register" className="text-accent hover:underline">
              Create one
            </Link>
          </p>
        )}
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const inviteToken = params.get("invite") ?? undefined;
  const navigate = useNavigate();
  const me = useMe();
  const refresh = useRefreshMe();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<{ needsSetup: boolean; allowSignup: boolean }>("/auth/status") });
  const invite = useQuery({
    queryKey: ["invite", inviteToken],
    enabled: Boolean(inviteToken),
    queryFn: () => api.get<{ email: string; role: string; projectName: string; userExists: boolean }>(`/auth/invite/${inviteToken}`),
  });
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const acceptExisting = async () => {
    setLoading(true);
    try {
      const r = await api.post<{ projectId: string }>(`/auth/invite/${inviteToken}/accept`);
      await refresh();
      navigate(`/p/${r.projectId}`);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  if (me.data && inviteToken && invite.data) {
    return (
      <Shell title={`Join ${invite.data.projectName}`} subtitle={`You were invited as ${invite.data.role.toLowerCase()}.`}>
        <ErrorBox error={error} className="mb-3" />
        <Button variant="primary" className="w-full" onClick={acceptExisting} loading={loading}>
          Accept invite as {me.data.user.email}
        </Button>
      </Shell>
    );
  }
  if (me.data) return <Navigate to="/" replace />;

  const closed = status.data && !status.data.needsSetup && !status.data.allowSignup && !inviteToken;
  const email = invite.data?.email ?? form.email;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/register", { ...form, email, inviteToken });
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell
      title={status.data?.needsSetup ? "Set up your workspace" : invite.data ? `Join ${invite.data.projectName}` : "Create account"}
      subtitle={status.data?.needsSetup ? "The first account becomes the administrator." : invite.data ? `You were invited as ${invite.data.role.toLowerCase()}.` : undefined}
    >
      {closed ? (
        <p className="text-sm text-ink-2">Sign-up is invite-only. Ask a project owner to send you an invite link.</p>
      ) : invite.error ? (
        <ErrorBox error={invite.error} />
      ) : invite.data?.userExists ? (
        <p className="text-sm text-ink-2">
          An account for {invite.data.email} already exists.{" "}
          <Link className="text-accent hover:underline" to={`/login?next=${encodeURIComponent(`/register?invite=${inviteToken}`)}`}>
            Sign in to accept
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} disabled={Boolean(invite.data)} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            Create account
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-ink-2">
        Already have an account?{" "}
        <Link to="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}
