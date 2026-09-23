/**
 * A local stand-in for an OAuth-protected MCP deployment, shaped like the Hexifyer one
 * (one authorization server, two product mounts). Used by the tests and for trying the
 * dashboard's OAuth 2.1 flow without the real backend:
 *
 *   npm run mock:oauth-mcp -w @aieval/server        → http://localhost:8090
 *   MCP URLs:  http://localhost:8090/polaris/mcp  and  http://localhost:8090/devstudio/mcp
 *
 * Implements what a strict MCP authorization server enforces: RFC 9728 protected-resource
 * metadata per mount, RFC 8414 metadata, RFC 7591 registration (public clients, https or
 * loopback redirect URIs), PKCE S256 required, RFC 8707 `resource` required and pinned into
 * the token, refresh-token rotation where reusing a rotated token revokes the whole family.
 */
import { createHash, randomBytes } from "node:crypto";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Same names as the Hexifyer authorization server (OAUTH_SCOPE_NAMES); default is read-only.
const SCOPES = ["projects:read", "tasks:read", "topics:read", "sprints:read", "tasks:write", "topics:write", "sprints:write"] as const;
const DEFAULT_SCOPES = ["projects:read", "tasks:read", "topics:read"];
const MOUNTS = { polaris: "Polaris", devstudio: "DevStudio" } as const;
type Slug = keyof typeof MOUNTS;

interface Client { id: string; name: string; redirectUris: string[] }
interface Code { clientId: string; redirectUri: string; challenge: string; resource: string; scopes: string[]; expires: number; used: boolean; family: string }
interface Access { resource: string; scopes: string[]; expires: number; clientId: string }
interface Refresh { clientId: string; resource: string; scopes: string[]; family: string; revoked: boolean }

const b64url = (buf: Buffer) => buf.toString("base64url");
const token = () => b64url(randomBytes(24));

function isAllowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(u.hostname));
  } catch {
    return false;
  }
}

export function createMockOAuthMcpApp(opts: { baseUrl: string; tokenTtlSeconds?: number }) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const ttl = opts.tokenTtlSeconds ?? 900;
  const clients = new Map<string, Client>();
  const codes = new Map<string, Code>();
  const access = new Map<string, Access>();
  const refresh = new Map<string, Refresh>();
  const stats = { tokenRequests: 0, refreshes: 0, familyRevocations: 0 };
  const resourceOf = (slug: Slug) => `${base}/${slug}/mcp`;

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const oauthError = (res: Response, status: number, error: string, description: string) => res.status(status).json({ error, error_description: description });

  // ── authorization server ──────────────────────────────────────────────────
  const asMetadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  };
  app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(asMetadata));

  app.post("/oauth/register", (req, res) => {
    const uris = req.body?.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === "string" && isAllowedRedirect(u))) {
      return oauthError(res, 400, "invalid_client_metadata", "redirect_uris must be https or http loopback");
    }
    const client: Client = { id: `mock_${token()}`, name: String(req.body.client_name ?? "client"), redirectUris: uris };
    clients.set(client.id, client);
    res.status(201).json({
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  app.get("/oauth/authorize", (req, res) => {
    const q = req.query as Record<string, string>;
    const client = clients.get(q.client_id);
    if (!client || !client.redirectUris.includes(q.redirect_uri)) return oauthError(res, 400, "invalid_request", "Unknown client or unregistered redirect_uri");
    if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge ?? "")) {
      return oauthError(res, 400, "invalid_request", "PKCE S256 is required");
    }
    const slug = (Object.keys(MOUNTS) as Slug[]).find((s) => resourceOf(s) === (q.resource ?? "").replace(/\/$/, ""));
    if (!slug) return oauthError(res, 400, "invalid_target", "resource must name one of this server's MCP mounts");
    const scopes = q.scope ? q.scope.split(" ").filter(Boolean) : DEFAULT_SCOPES;
    if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) return oauthError(res, 400, "invalid_scope", `Unknown scope; supported: ${SCOPES.join(" ")}`);
    const fields = Object.entries({ ...q, scope: scopes.join(" ") })
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}">`)
      .join("");
    res.type("html").send(`<!doctype html><title>Mock consent</title><body style="font:14px system-ui;padding:2rem">
      <h1>Connect ${client.name} to ${MOUNTS[slug]}</h1><p>Requested scopes: <code>${scopes.join(" ")}</code></p>
      <form method="post" action="/oauth/authorize/confirm">${fields}
        <button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button></form></body>`);
  });

  app.post("/oauth/authorize/confirm", (req, res) => {
    const b = req.body as Record<string, string>;
    const client = clients.get(b.client_id);
    if (!client || !client.redirectUris.includes(b.redirect_uri)) return oauthError(res, 400, "invalid_request", "Unknown client");
    const target = new URL(b.redirect_uri);
    if (b.state) target.searchParams.set("state", b.state);
    if (b.decision !== "allow") {
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("error_description", "The user denied the request");
      return res.redirect(302, target.toString());
    }
    const code = token();
    codes.set(code, { clientId: client.id, redirectUri: b.redirect_uri, challenge: b.code_challenge, resource: b.resource.replace(/\/$/, ""), scopes: b.scope.split(" "), expires: Date.now() + 60_000, used: false, family: token() });
    target.searchParams.set("code", code);
    res.redirect(302, target.toString());
  });

  const issue = (clientId: string, resource: string, scopes: string[], family: string) => {
    const at = token();
    const rt = token();
    access.set(at, { resource, scopes, clientId, expires: Date.now() + ttl * 1000 });
    refresh.set(rt, { clientId, resource, scopes, family, revoked: false });
    return { access_token: at, token_type: "Bearer", expires_in: ttl, refresh_token: rt, scope: scopes.join(" ") };
  };
  const revokeFamily = (family: string) => {
    stats.familyRevocations++;
    for (const r of refresh.values()) if (r.family === family) r.revoked = true;
  };

  app.post("/oauth/token", (req, res) => {
    stats.tokenRequests++;
    const b = req.body as Record<string, string>;
    res.set("Cache-Control", "no-store");
    if (b.grant_type === "authorization_code") {
      const code = codes.get(b.code);
      if (!code || code.expires < Date.now()) return oauthError(res, 400, "invalid_grant", "Unknown or expired code");
      if (code.used) {
        revokeFamily(code.family);
        return oauthError(res, 400, "invalid_grant", "Code already used");
      }
      if (code.clientId !== b.client_id || code.redirectUri !== b.redirect_uri) return oauthError(res, 400, "invalid_grant", "client_id / redirect_uri mismatch");
      const challenge = b64url(createHash("sha256").update(b.code_verifier ?? "").digest());
      if (challenge !== code.challenge) return oauthError(res, 400, "invalid_grant", "PKCE verification failed");
      if (b.resource && b.resource.replace(/\/$/, "") !== code.resource) return oauthError(res, 400, "invalid_target", "resource differs from the authorization request");
      code.used = true;
      return res.json(issue(code.clientId, code.resource, code.scopes, code.family));
    }
    if (b.grant_type === "refresh_token") {
      stats.refreshes++;
      const r = refresh.get(b.refresh_token);
      if (!r || r.clientId !== b.client_id) return oauthError(res, 400, "invalid_grant", "Unknown refresh token");
      if (r.revoked) {
        // Reuse of a rotated token: treat as theft and end the whole grant.
        revokeFamily(r.family);
        return oauthError(res, 400, "invalid_grant", "Refresh token reuse detected — grant revoked");
      }
      r.revoked = true;
      return res.json(issue(r.clientId, r.resource, r.scopes, r.family));
    }
    return oauthError(res, 400, "unsupported_grant_type", "authorization_code or refresh_token");
  });

  app.post("/oauth/revoke", (req, res) => {
    const r = refresh.get(String(req.body?.token ?? ""));
    if (r) revokeFamily(r.family);
    res.json({});
  });

  // ── protected MCP mounts ──────────────────────────────────────────────────
  for (const slug of Object.keys(MOUNTS) as Slug[]) {
    const prmUrl = `${base}/.well-known/oauth-protected-resource/${slug}/mcp`;
    app.get(`/.well-known/oauth-protected-resource/${slug}/mcp`, (_req, res) =>
      res.json({ resource: resourceOf(slug), authorization_servers: [base], scopes_supported: SCOPES, bearer_methods_supported: ["header"] }),
    );

    app.all(`/${slug}/mcp`, async (req: Request, res: Response) => {
      const header = req.headers.authorization ?? "";
      const grant = header.startsWith("Bearer ") ? access.get(header.slice(7)) : undefined;
      const challenge = (error?: string) =>
        res
          .status(401)
          .set("WWW-Authenticate", `Bearer${error ? ` error="${error}",` : ""} resource_metadata="${prmUrl}"`)
          .json({ error: error ?? "unauthorized" });
      if (!grant) return challenge(header ? "invalid_token" : undefined);
      if (grant.expires < Date.now()) return challenge("invalid_token");
      if (grant.resource !== resourceOf(slug)) return challenge("insufficient_scope");

      const server = new McpServer({ name: `mock-${slug}`, version: "1.0.0" });
      server.registerTool("whoami", { description: `Which product and scopes this connection has (${MOUNTS[slug]})`, inputSchema: {} }, async () => ({
        content: [{ type: "text", text: JSON.stringify({ product: MOUNTS[slug], scopes: grant.scopes }) }],
      }));
      server.registerTool(
        "get_task",
        { description: "Look up a task by key", inputSchema: { key: z.string().describe("Task key, e.g. MC-1") } },
        async ({ key }) => ({ content: [{ type: "text", text: JSON.stringify({ key, title: `Mock task ${key}`, status: "In Progress", product: MOUNTS[slug] }) }] }),
      );
      server.registerTool(
        "create_task",
        { description: "Create a task (needs tasks:write)", inputSchema: { title: z.string() } },
        async ({ title }) =>
          grant.scopes.includes("tasks:write")
            ? { content: [{ type: "text", text: JSON.stringify({ created: true, key: "MC-99", title }) }] }
            : { isError: true, content: [{ type: "text", text: "insufficient_scope: tasks:write" }] },
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
  }

  app.get("/", (_req, res) => res.json({ mounts: Object.keys(MOUNTS).map((s) => resourceOf(s as Slug)), stats }));

  return { app, stats, expireAllAccessTokens: () => access.forEach((a) => (a.expires = 0)) };
}

// CLI: `tsx src/dev/mockOAuthMcpServer.ts`
if (process.argv[1]?.replace(/\\/g, "/").endsWith("dev/mockOAuthMcpServer.ts")) {
  const port = Number(process.env.MOCK_OAUTH_PORT ?? 8090);
  const { app } = createMockOAuthMcpApp({ baseUrl: `http://localhost:${port}`, tokenTtlSeconds: Number(process.env.MOCK_TOKEN_TTL ?? 900) });
  app.listen(port, () => {
    console.log(`[mock-oauth-mcp] http://localhost:${port}`);
    console.log(`  Polaris   MCP: http://localhost:${port}/polaris/mcp`);
    console.log(`  DevStudio MCP: http://localhost:${port}/devstudio/mcp`);
  });
}
