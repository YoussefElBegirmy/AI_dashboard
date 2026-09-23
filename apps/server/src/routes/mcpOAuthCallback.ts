import type { Request, Response } from "express";
import { prisma } from "../db";
import { env } from "../env";
import { mcpManager } from "../engine/mcp/manager";
import { finishOAuth } from "../engine/mcp/oauth";
import { loadSecrets } from "../engine/secrets";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The page the authorization server redirects to. It finishes the exchange, then tells the
 * dashboard window that opened the popup (postMessage, same origin only) and closes itself.
 */
function page(res: Response, opts: { ok: boolean; title: string; message: string; serverId?: string; backTo?: string }) {
  const payload = JSON.stringify({ type: "mcp-oauth", ok: opts.ok, serverId: opts.serverId ?? null, message: opts.message });
  res
    .status(opts.ok ? 200 : 400)
    .type("html")
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.1rem; margin: 0 0 .5rem; color: ${opts.ok ? "#0ca30c" : "#d03b3b"}; }
  p { opacity: .8; line-height: 1.5; } a { color: #7c3aed; }
</style></head>
<body><main><h1>${escape(opts.title)}</h1><p>${escape(opts.message)}</p>
${opts.backTo ? `<p><a href="${escape(opts.backTo)}">Back to the dashboard</a></p>` : ""}</main>
<script>
  try { if (window.opener) { window.opener.postMessage(${payload}, ${JSON.stringify(new URL(env.appUrl).origin)}); ${opts.ok ? "setTimeout(function(){ window.close(); }, 700);" : ""} } } catch (e) {}
</script></body></html>`);
}

export async function mcpOAuthCallback(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  if (!req.user) {
    return page(res, { ok: false, title: "Not signed in", message: "Sign in to the dashboard in this browser, then start the MCP sign-in again.", backTo: "/login" });
  }
  if (!q.state) return page(res, { ok: false, title: "Sign-in failed", message: "The authorization server did not return a state parameter.", backTo: "/" });

  let server;
  try {
    server = await finishOAuth({ state: q.state, code: q.code, error: q.error, errorDescription: q.error_description, userId: req.user.id, userName: req.user.name });
  } catch (err) {
    return page(res, { ok: false, title: "Sign-in failed", message: (err as Error).message, backTo: "/" });
  }

  // Connect straight away so the capability list is fresh when the user looks back.
  const backTo = `/p/${server.projectId}/mcp/${server.id}`;
  try {
    const fresh = await prisma.mcpServer.findUniqueOrThrow({ where: { id: server.id } });
    await mcpManager.disconnect(server.id);
    const caps = await mcpManager.capabilities(fresh, await loadSecrets(server.projectId));
    await prisma.mcpServer.update({
      where: { id: server.id },
      data: { status: "connected", lastError: null, lastCheckedAt: new Date(), capabilities: JSON.parse(JSON.stringify(caps)) },
    });
    return page(res, { ok: true, title: `Connected to ${server.name}`, message: `Signed in. ${caps.tools.length} tools available. You can close this window.`, serverId: server.id, backTo });
  } catch (err) {
    await prisma.mcpServer.update({ where: { id: server.id }, data: { status: "error", lastError: (err as Error).message, lastCheckedAt: new Date() } });
    return page(res, { ok: true, title: "Signed in", message: `Tokens saved, but connecting failed: ${(err as Error).message}`, serverId: server.id, backTo });
  }
}
