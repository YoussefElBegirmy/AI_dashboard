/**
 * OAuth 2.1 for remote MCP servers (MCP Authorization spec).
 *
 * The MCP SDK does the protocol work — RFC 9728 protected-resource discovery, RFC 8414
 * authorization-server metadata, RFC 7591 dynamic client registration, PKCE (S256), the
 * RFC 8707 `resource` indicator and refresh on 401. This module is the SDK's
 * `OAuthClientProvider`, persisted per MCP server row:
 *
 *   Sign in  → startOAuth()  → authorization URL, opened by the browser in a popup
 *   Callback → finishOAuth() → code + verifier exchanged for tokens, stored encrypted
 *   Runs     → createAuthProvider() on the pooled transport; refreshes as needed
 *
 * Credentials belong to the MCP server (i.e. the project), not to a viewer: every run in
 * the project calls the server as whoever signed in, which the UI states plainly.
 */
import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { mcpServerConfigSchema, type McpAuthConfig, type McpOAuthInfo, type McpOAuthStatus } from "@aieval/shared";
import { prisma } from "../../db";
import { env } from "../../env";
import { decrypt, encrypt } from "../../lib/crypto";
import { loadSecrets } from "../secrets";
import { render } from "../template";

interface StoredOAuth {
  /** Dynamic registration result (absent when a client id is configured). */
  client?: OAuthClientInformationMixed;
  /** redirect_uri the client was registered with — re-register if it changes. */
  clientRedirect?: string;
  tokens?: OAuthTokens;
  obtainedAt?: number;
  codeVerifier?: string;
  discovery?: OAuthDiscoveryState;
  pending?: { startedBy: string; startedAt: number };
}

interface ServerRef {
  id: string;
  projectId: string;
  config: unknown;
}

export class McpAuthRequiredError extends Error {
  constructor(message = "Sign-in required: open this MCP server in the dashboard and press “Sign in”.") {
    super(message);
  }
}

/** Where the authorization server sends the browser back. Same origin as the web app. */
export function oauthRedirectUrl(): string {
  return `${env.appUrl.replace(/\/$/, "")}/api/mcp-oauth/callback`;
}

// ── persistence: in-memory cache, write-through (serialized per server) to the DB ──────

const cache = new Map<string, StoredOAuth>();
const writes = new Map<string, Promise<unknown>>();

async function load(serverId: string): Promise<StoredOAuth> {
  const hit = cache.get(serverId);
  if (hit) return hit;
  const row = await prisma.mcpServer.findUnique({ where: { id: serverId }, select: { oauthData: true } });
  let data: StoredOAuth = {};
  if (row?.oauthData) {
    try {
      data = JSON.parse(decrypt(row.oauthData));
    } catch {
      data = {}; // wrong MASTER_KEY or corrupt — behave as "not signed in"
    }
  }
  cache.set(serverId, data);
  return data;
}

function persist(serverId: string, data: StoredOAuth, columns: Record<string, unknown> = {}) {
  cache.set(serverId, data);
  const prev = writes.get(serverId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => prisma.mcpServer.update({ where: { id: serverId }, data: { oauthData: encrypt(JSON.stringify(data)), ...columns } }));
  writes.set(serverId, next);
  return next;
}

export function forgetOAuthCache(serverId: string) {
  cache.delete(serverId);
}

function authConfigOf(server: ServerRef): McpAuthConfig & { url: string } {
  const cfg = mcpServerConfigSchema.parse(server.config ?? {});
  return { ...cfg.auth, url: cfg.url };
}

// ── refresh de-duplication ─────────────────────────────────────────────────────────────
//
// Authorization servers that rotate refresh tokens (OAuth 2.1 §4.3.1 for public clients)
// often treat a second use of the same refresh token as theft and revoke the whole token
// family. Parallel test cases can all hit a 401 at once and each start a refresh, so
// concurrent refreshes with the same token share one request and one answer.

const inflightRefresh = new Map<string, Promise<{ status: number; statusText: string; headers: [string, string][]; body: string }>>();

export const oauthFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const body = init?.body;
  if (init?.method?.toUpperCase() === "POST" && (typeof body === "string" || body instanceof URLSearchParams)) {
    const params = new URLSearchParams(String(body));
    const refreshToken = params.get("grant_type") === "refresh_token" ? params.get("refresh_token") : null;
    if (refreshToken) {
      let pending = inflightRefresh.get(refreshToken);
      if (!pending) {
        pending = fetch(url, init).then(async (r) => ({ status: r.status, statusText: r.statusText, headers: [...r.headers.entries()], body: await r.text() }));
        inflightRefresh.set(refreshToken, pending);
        // keep the answer briefly for stragglers that read the old token just before rotation
        pending.finally(() => setTimeout(() => inflightRefresh.delete(refreshToken), 30_000)).catch(() => {});
      }
      const r = await pending;
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
    }
  }
  return fetch(url, init);
};

// ── the provider ───────────────────────────────────────────────────────────────────────

class DbOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  private readonly cfg: McpAuthConfig & { url: string };

  constructor(
    private readonly server: ServerRef,
    private data: StoredOAuth,
    private readonly secrets: Record<string, string>,
    private readonly interactive: boolean,
  ) {
    this.cfg = authConfigOf(server);
  }

  get redirectUrl() {
    return oauthRedirectUrl();
  }

  private get clientSecret(): string | undefined {
    const name = this.cfg.clientSecretName;
    return name ? this.secrets[name] || undefined : undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.cfg.clientName || "AI Eval Dashboard",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.clientSecret ? "client_secret_post" : "none",
      ...(this.cfg.scope.trim() && { scope: this.cfg.scope.trim() }),
    };
  }

  async state() {
    const state = randomBytes(24).toString("base64url");
    // Only an interactive sign-in owns the callback slot; a background refresh that falls
    // back to authorization must not overwrite the state of a sign-in in progress.
    if (this.interactive) await prisma.mcpServer.update({ where: { id: this.server.id }, data: { oauthState: state } });
    return state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const clientId = render(this.cfg.clientId, { secrets: this.secrets }).trim();
    if (clientId) return { client_id: clientId, ...(this.clientSecret && { client_secret: this.clientSecret }) };
    if (this.data.client && this.data.clientRedirect === this.redirectUrl) return this.data.client;
    return undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    this.data = { ...this.data, client: info, clientRedirect: this.redirectUrl };
    await persist(this.server.id, this.data);
  }

  tokens() {
    return this.data.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    const obtainedAt = Date.now();
    this.data = { ...this.data, tokens, obtainedAt, codeVerifier: undefined };
    await persist(this.server.id, this.data, {
      oauthStatus: "authorized" satisfies McpOAuthStatus,
      oauthScope: tokens.scope ?? (this.cfg.scope || null),
      oauthExpiresAt: tokens.expires_in ? new Date(obtainedAt + tokens.expires_in * 1000) : null,
      oauthError: null,
    });
  }

  async redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
    if (!this.interactive) {
      // A background call (a run, a health check) cannot open a browser: the refresh token is
      // gone or was rejected. Record it so the UI can ask a person to sign in again.
      await prisma.mcpServer.update({ where: { id: this.server.id }, data: { oauthStatus: "needs_auth" satisfies McpOAuthStatus } });
    }
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.data = { ...this.data, codeVerifier };
    await persist(this.server.id, this.data);
  }

  codeVerifier() {
    if (!this.data.codeVerifier) throw new Error("No PKCE verifier stored — start the sign-in again.");
    return this.data.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    const d = { ...this.data };
    if (scope === "all" || scope === "client") delete d.client;
    if (scope === "all" || scope === "tokens") delete d.tokens;
    if (scope === "all" || scope === "verifier") delete d.codeVerifier;
    if (scope === "all" || scope === "discovery") delete d.discovery;
    this.data = d;
    await persist(this.server.id, d, scope === "all" || scope === "tokens" ? { oauthStatus: "needs_auth", oauthExpiresAt: null } : {});
  }

  async saveDiscoveryState(state: OAuthDiscoveryState) {
    this.data = { ...this.data, discovery: state };
    await persist(this.server.id, this.data);
  }

  discoveryState() {
    return this.data.discovery;
  }

  get snapshot() {
    return this.data;
  }
}

/** Provider for the pooled, non-interactive MCP transport. */
export async function createAuthProvider(server: ServerRef, secrets: Record<string, string>): Promise<OAuthClientProvider> {
  return new DbOAuthProvider(server, await load(server.id), secrets, false);
}

function describe(err: unknown): string {
  const e = err as Error & { errorCode?: string; error?: string };
  const code = e.errorCode ?? e.error;
  return code && !e.message.includes(code) ? `${code}: ${e.message}` : e.message;
}

/**
 * Begins sign-in. Returns the URL to open, or `authorized` if the server needed no
 * interaction (e.g. a still-valid refresh token after a config change).
 */
export async function startOAuth(server: ServerRef, secrets: Record<string, string>, userId: string): Promise<{ authorizationUrl?: string; status: McpOAuthStatus }> {
  const cfg = authConfigOf(server);
  if (cfg.type !== "oauth") throw new Error("This MCP server is not configured for OAuth");
  const serverUrl = render(cfg.url, { secrets });

  // A deliberate "Sign in" means a fresh grant: drop tokens and any half-finished attempt,
  // keep the client registration and discovery.
  const current = await load(server.id);
  const data: StoredOAuth = { client: current.client, clientRedirect: current.clientRedirect, discovery: current.discovery, pending: { startedBy: userId, startedAt: Date.now() } };
  await persist(server.id, data, { oauthError: null });

  const provider = new DbOAuthProvider(server, data, secrets, true);
  try {
    const result = await auth(provider, { serverUrl, scope: cfg.scope.trim() || undefined, fetchFn: oauthFetch });
    if (result === "REDIRECT" && provider.authorizationUrl) return { authorizationUrl: provider.authorizationUrl.toString(), status: "needs_auth" };
    return { status: "authorized" };
  } catch (err) {
    const message = describe(err);
    await prisma.mcpServer.update({ where: { id: server.id }, data: { oauthError: message } });
    throw new Error(`OAuth discovery / registration failed: ${message}`);
  }
}

/** Completes sign-in from the redirect. Only the person who started it may finish it. */
export async function finishOAuth(opts: { state: string; code?: string; error?: string; errorDescription?: string; userId: string; userName: string }) {
  const server = await prisma.mcpServer.findUnique({ where: { oauthState: opts.state } });
  if (!server) throw new Error("This sign-in link has expired or was already used. Start again from the MCP server page.");
  const data = await load(server.id);

  const clearState = { oauthState: null };
  if (!data.pending || data.pending.startedBy !== opts.userId) {
    throw new Error("This sign-in was started by a different dashboard user.");
  }
  if (Date.now() - data.pending.startedAt > 15 * 60_000) {
    await prisma.mcpServer.update({ where: { id: server.id }, data: { ...clearState, oauthError: "Sign-in timed out" } });
    throw new Error("Sign-in took too long. Start again from the MCP server page.");
  }
  if (opts.error || !opts.code) {
    const message = opts.errorDescription || opts.error || "No authorization code returned";
    await persist(server.id, { ...data, pending: undefined, codeVerifier: undefined }, { ...clearState, oauthError: message });
    throw new Error(`The authorization server declined: ${message}`);
  }

  const secrets = await loadSecrets(server.projectId);
  const provider = new DbOAuthProvider(server, data, secrets, true);
  const serverUrl = render(authConfigOf(server).url, { secrets });
  try {
    await auth(provider, { serverUrl, authorizationCode: opts.code, fetchFn: oauthFetch });
  } catch (err) {
    const message = describe(err);
    await prisma.mcpServer.update({ where: { id: server.id }, data: { ...clearState, oauthError: message } });
    throw new Error(`Token exchange failed: ${message}`);
  }
  await persist(server.id, { ...provider.snapshot, pending: undefined }, { ...clearState, oauthAuthorizedAt: new Date(), oauthAuthorizedBy: opts.userName, oauthError: null });
  return server;
}

/** Forgets the tokens, revoking the refresh token first when the server supports RFC 7009. */
export async function disconnectOAuth(server: ServerRef, secrets: Record<string, string>) {
  const data = await load(server.id);
  const refresh = data.tokens?.refresh_token;
  const revocation = (data.discovery?.authorizationServerMetadata as { revocation_endpoint?: string } | undefined)?.revocation_endpoint;
  if (refresh && revocation) {
    const provider = new DbOAuthProvider(server, data, secrets, false);
    const client = provider.clientInformation();
    const body = new URLSearchParams({ token: refresh, token_type_hint: "refresh_token", ...(client?.client_id && { client_id: client.client_id }) });
    await fetch(revocation, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
  await persist(server.id, { client: data.client, clientRedirect: data.clientRedirect, discovery: data.discovery }, {
    oauthStatus: "none",
    oauthState: null,
    oauthAuthorizedAt: null,
    oauthAuthorizedBy: null,
    oauthScope: null,
    oauthExpiresAt: null,
    oauthError: null,
  });
}

/** Browser-safe summary. Never includes tokens. */
export function oauthInfo(row: {
  config: unknown;
  oauthStatus: string;
  oauthAuthorizedAt: Date | null;
  oauthAuthorizedBy: string | null;
  oauthScope: string | null;
  oauthExpiresAt: Date | null;
  oauthError: string | null;
  id: string;
}): McpOAuthInfo | null {
  const cfg = mcpServerConfigSchema.safeParse(row.config ?? {});
  if (!cfg.success || cfg.data.auth.type !== "oauth") return null;
  const data = cache.get(row.id);
  return {
    status: (row.oauthStatus as McpOAuthStatus) ?? "none",
    authorizedAt: row.oauthAuthorizedAt?.toISOString() ?? null,
    authorizedBy: row.oauthAuthorizedBy,
    scope: row.oauthScope,
    expiresAt: row.oauthExpiresAt?.toISOString() ?? null,
    clientId: cfg.data.auth.clientId || (data?.client?.client_id ?? null),
    authorizationServer: data?.discovery?.authorizationServerUrl ?? null,
    lastError: row.oauthError,
  };
}
