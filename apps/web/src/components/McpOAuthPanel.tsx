import { useMutation } from "@tanstack/react-query";
import { KeyRound, LogIn, LogOut, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, p } from "../lib/api";
import { ago, dateTime } from "../lib/format";
import type { McpServer } from "../lib/types";
import { Badge, Button, Card, ErrorBox } from "./ui";

/**
 * OAuth 2.1 connection state for one MCP server, with sign-in in a popup.
 * The popup lands on /api/mcp-oauth/callback, which posts a message back here.
 */
export function McpOAuthPanel({ server, projectId, canEdit, onChange }: { server: McpServer; projectId: string; canEdit: boolean; onChange: () => void }) {
  const oauth = server.oauth;
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [waiting, setWaiting] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "mcp-oauth") return;
      setWaiting(false);
      // the popup text addresses the popup ("you can close this window"); restate it for this page
      const text = String(e.data.message ?? "").replace(/\s*You can close this window\.?/, "");
      setNotice({ ok: Boolean(e.data.ok), text });
      onChangeRef.current();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // If the user closes the popup without finishing, stop waiting.
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => {
      if (popupRef.current?.closed) {
        setWaiting(false);
        onChangeRef.current();
      }
    }, 800);
    return () => window.clearInterval(t);
  }, [waiting]);

  const disconnect = useMutation({
    mutationFn: () => api.post(p(projectId, `/mcp-servers/${server.id}/oauth/disconnect`)),
    onSuccess: () => {
      setNotice({ ok: true, text: "Disconnected. The refresh token was revoked where the server supports it." });
      onChange();
    },
  });

  if (!oauth) return null;

  const signIn = async () => {
    setError(null);
    setNotice(null);
    // Open synchronously in the click handler so popup blockers allow it.
    const popup = window.open("about:blank", `mcp-oauth-${server.id}`, "width=560,height=760");
    popupRef.current = popup;
    try {
      const r = await api.post<{ authorizationUrl?: string; status: string }>(p(projectId, `/mcp-servers/${server.id}/oauth/start`));
      if (r.authorizationUrl) {
        if (popup) {
          popup.location.href = r.authorizationUrl;
          setWaiting(true);
        } else {
          window.location.href = r.authorizationUrl; // popup blocked: full-page redirect
        }
      } else {
        popup?.close();
        onChange();
      }
    } catch (e) {
      popup?.close();
      setError(e);
    }
  };

  const status = oauth.status;
  const scopes = (oauth.scope ?? "").split(" ").filter(Boolean);

  return (
    <Card
      className="mb-4"
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-accent" /> OAuth 2.1
          {status === "authorized" ? <Badge tone="good">Signed in</Badge> : status === "needs_auth" ? <Badge tone="warn">Sign-in required</Badge> : <Badge>Not connected</Badge>}
        </span>
      }
      actions={
        canEdit && (
          <>
            {status === "authorized" ? (
              <>
                <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={signIn} loading={waiting}>
                  Re-authorize
                </Button>
                <Button size="sm" variant="danger" icon={<LogOut className="size-3.5" />} onClick={() => disconnect.mutate()} loading={disconnect.isPending}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={signIn} loading={waiting}>
                {waiting ? "Waiting for sign-in…" : "Sign in"}
              </Button>
            )}
          </>
        )
      }
    >
      {status === "authorized" ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Signed in by</dt>
            <dd>
              {oauth.authorizedBy ?? "—"} <span className="text-xs text-muted">· {ago(oauth.authorizedAt)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Access token</dt>
            <dd>{oauth.expiresAt ? `valid until ${dateTime(oauth.expiresAt)} · refreshed automatically` : "refreshed automatically"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Granted scopes</dt>
            <dd className="mt-1 flex flex-wrap gap-1">{scopes.length ? scopes.map((s) => <Badge key={s} tone="accent">{s}</Badge>) : <span className="text-muted">server default</span>}</dd>
          </div>
          {oauth.authorizationServer && (
            <div>
              <dt className="text-xs text-muted">Authorization server</dt>
              <dd className="truncate font-mono text-xs">{oauth.authorizationServer}</dd>
            </div>
          )}
          {oauth.clientId && (
            <div>
              <dt className="text-xs text-muted">Client ID</dt>
              <dd className="truncate font-mono text-xs">{oauth.clientId}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-ink-2">
          {status === "needs_auth" ? "The stored grant expired or was revoked. Sign in again to keep testing this server." : "Sign in to let the dashboard call this server's tools."} A popup opens the
          server's own sign-in and consent page. Runs, the playground and LLM targets then use this connection for everyone in the project.
        </p>
      )}
      {waiting && <p className="mt-3 text-xs text-muted">Finish signing in in the popup window…</p>}
      {notice && <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.ok ? "border border-good/30 bg-good/5 text-good-text" : "border border-critical/30 bg-critical/5 text-critical"}`}>{notice.text}</div>}
      {oauth.lastError && status !== "authorized" && <ErrorBox error={oauth.lastError} className="mt-3" />}
      <ErrorBox error={error ?? disconnect.error} className="mt-3" />
    </Card>
  );
}
