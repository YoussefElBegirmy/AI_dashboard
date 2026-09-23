/**
 * OAuth 2.1 MCP connection, end to end, against the local mock authorization server +
 * protected MCP mounts (src/dev/mockOAuthMcpServer.ts). Needs TEST_DATABASE_URL like api.test.ts.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import session from "express-session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockOAuthMcpApp } from "../dev/mockOAuthMcpServer";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("MCP OAuth 2.1", () => {
  let api: Server;
  let mockServer: Server;
  let mock: ReturnType<typeof createMockOAuthMcpApp>;
  let base: string;
  let mockBase: string;
  let owner: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let prisma: typeof import("../db").prisma;
  let projectId = "";
  let serverId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.MASTER_KEY = "test-master-key";
    process.env.ALLOW_SIGNUP = "true";
    ({ prisma } = await import("../db"));
    await prisma.$executeRawUnsafe(
      `TRUNCATE "EvaluationResult","RunResult","Run","TestCase","Suite","McpServer","Target","Secret","ApiToken","Invite","ProjectMember","Project","User" CASCADE`,
    );

    // mock MCP deployment on a random port; its base URL must be known before it is built
    const holder = await new Promise<Server>((resolve) => {
      const s = (require("node:http") as typeof import("node:http")).createServer();
      s.listen(0, () => resolve(s));
    });
    mockBase = `http://127.0.0.1:${(holder.address() as AddressInfo).port}`;
    mock = createMockOAuthMcpApp({ baseUrl: mockBase, tokenTtlSeconds: 900 });
    holder.on("request", mock.app);
    mockServer = holder;

    const { createApp } = await import("../app");
    const { env } = await import("../env");
    env.allowSignup = true;
    api = createApp({ sessionStore: new session.MemoryStore() }).listen(0);
    base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    owner = request.agent(base);
    other = request.agent(base);

    await owner.post("/api/auth/register").send({ email: "owner@oauth.test", name: "Owner", password: "password123" }).expect(201);
    await other.post("/api/auth/register").send({ email: "other@oauth.test", name: "Other", password: "password123" }).expect(201);
    projectId = (await owner.get("/api/auth/me")).body.projects[0].id;
    // make "other" an editor on the same project so only the state binding stops them
    await owner.post(`/api/projects/${projectId}/members`).send({ email: "other@oauth.test", role: "EDITOR" }).expect(201);
  });

  afterAll(async () => {
    api?.close();
    mockServer?.close();
    const { mcpManager } = await import("../engine/mcp/manager");
    await mcpManager.closeAll();
    await prisma?.$disconnect();
  });

  /** Plays the user: open the authorization URL, press Allow, return the callback path. */
  async function consent(authorizationUrl: string, decision: "allow" | "deny" = "allow") {
    const url = new URL(authorizationUrl);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    const form = new URLSearchParams(Object.fromEntries(url.searchParams));
    form.set("decision", decision);
    const res = await fetch(`${mockBase}/oauth/authorize/confirm`, { method: "POST", body: form, redirect: "manual" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/api/mcp-oauth/callback");
    return location.pathname + location.search;
  }

  it("registers an OAuth server without trying to connect before sign-in", async () => {
    const res = await owner.post(`/api/projects/${projectId}/mcp-servers`).send({
      name: "polaris",
      transport: "STREAMABLE_HTTP",
      config: { url: `${mockBase}/polaris/mcp`, auth: { type: "oauth", scope: "projects:read tasks:read tasks:write" } },
    });
    expect(res.status).toBe(201);
    expect(res.body.needsAuth).toBe(true);
    expect(res.body.server.oauth.status).toBe("none");
    expect(res.body.server).not.toHaveProperty("oauthData");
    serverId = res.body.server.id;
  });

  it("walks discovery → DCR → PKCE authorize (with resource) → callback → connected", async () => {
    const start = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/oauth/start`).expect(200);
    const authUrl = new URL(start.body.authorizationUrl);
    expect(authUrl.origin + authUrl.pathname).toBe(`${mockBase}/oauth/authorize`);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("resource")).toBe(`${mockBase}/polaris/mcp`);
    expect(authUrl.searchParams.get("scope")).toBe("projects:read tasks:read tasks:write");
    expect(authUrl.searchParams.get("redirect_uri")).toMatch(/\/api\/mcp-oauth\/callback$/);
    expect(authUrl.searchParams.get("client_id")).toMatch(/^mock_/);

    const callback = await consent(start.body.authorizationUrl);
    const done = await owner.get(callback);
    expect(done.status).toBe(200);
    expect(done.text).toContain("Connected to polaris");

    const server = await owner.get(`/api/projects/${projectId}/mcp-servers/${serverId}`).expect(200);
    expect(server.body.status).toBe("connected");
    expect(server.body.oauth).toMatchObject({ status: "authorized", authorizedBy: "Owner", scope: "projects:read tasks:read tasks:write" });
    expect(server.body.capabilities.tools.map((t: { name: string }) => t.name).sort()).toEqual(["create_task", "get_task", "whoami"]);
    expect(JSON.stringify(server.body)).not.toMatch(/access_token|refresh_token/);

    const row = await prisma.mcpServer.findUniqueOrThrow({ where: { id: serverId } });
    expect(row.oauthData).not.toContain("access_token"); // encrypted at rest
    expect(row.oauthState).toBeNull();
  });

  it("calls tools with the bearer token", async () => {
    const res = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/tools/call`).send({ name: "whoami", args: {} }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(JSON.parse(res.body.text)).toEqual({ product: "Polaris", scopes: ["projects:read", "tasks:read", "tasks:write"] });
  });

  it("refreshes once when the token expires, even with parallel calls (no reuse → no family revocation)", async () => {
    mock.expireAllAccessTokens();
    const before = mock.stats.refreshes;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/tools/call`).send({ name: "get_task", args: { key: `MC-${i}` } })),
    );
    for (const r of results) expect(r.body.ok, JSON.stringify(r.body)).toBe(true);
    expect(mock.stats.familyRevocations).toBe(0);
    expect(mock.stats.refreshes - before).toBe(1);
    // and the grant still works afterwards
    const again = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/tools/call`).send({ name: "whoami", args: {} });
    expect(again.body.ok).toBe(true);
  });

  it("uses the OAuth connection in suite runs (MCP tool target)", async () => {
    const target = await owner.post(`/api/projects/${projectId}/targets`).send({
      name: "Polaris get_task",
      kind: "MCP_TOOL",
      config: { serverId, toolName: "get_task", args: { key: "{{input.key}}" } },
    });
    expect(target.status).toBe(201);
    const suite = await owner.post(`/api/projects/${projectId}/suites`).send({
      name: "OAuth MCP",
      evaluators: [{ id: "c", name: "Has key", type: "contains", value: "{{input.key}}" }],
    });
    await owner.post(`/api/projects/${projectId}/suites/${suite.body.id}/cases/import`).send({ cases: [{ name: "one", input: { key: "MC-7" } }] });
    const run = await owner.post(`/api/projects/${projectId}/suites/${suite.body.id}/runs`).send({ targetIds: [target.body.id] }).expect(201);
    let detail;
    for (let i = 0; i < 50; i++) {
      detail = await owner.get(`/api/projects/${projectId}/runs/${run.body.id}`);
      if (["COMPLETED", "FAILED"].includes(detail.body.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(detail!.body.status).toBe("COMPLETED");
    expect(detail!.body.results[0].status).toBe("PASS");
  });

  it("only the user who started sign-in can finish it", async () => {
    const start = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/oauth/start`).expect(200);
    const callback = await consent(start.body.authorizationUrl);
    const hijack = await other.get(callback);
    expect(hijack.status).toBe(400);
    expect(hijack.text).toContain("different dashboard user");
    const bogus = await owner.get("/api/mcp-oauth/callback?state=nope&code=x");
    expect(bogus.status).toBe(400);
    // a denied consent is reported, not swallowed
    const start2 = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/oauth/start`).expect(200);
    const denied = await owner.get(await consent(start2.body.authorizationUrl, "deny"));
    expect(denied.status).toBe(400);
    expect(denied.text).toContain("denied");
  });

  it("disconnect revokes and forgets the grant", async () => {
    // sign in again (the previous test left a declined attempt)
    const start = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/oauth/start`).expect(200);
    await owner.get(await consent(start.body.authorizationUrl)).expect(200);
    const revocationsBefore = mock.stats.familyRevocations;

    const res = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/oauth/disconnect`).expect(200);
    expect(res.body.oauth.status).toBe("none");
    expect(mock.stats.familyRevocations).toBe(revocationsBefore + 1); // RFC 7009 revoke was sent
    const call = await owner.post(`/api/projects/${projectId}/mcp-servers/${serverId}/tools/call`).send({ name: "whoami", args: {} });
    expect(call.body.ok).toBe(false);
    expect(call.body.error).toMatch(/Sign-in required/);
  });

  it("a DevStudio mount gets its own grant (resource-pinned)", async () => {
    const res = await owner.post(`/api/projects/${projectId}/mcp-servers`).send({
      name: "devstudio",
      transport: "STREAMABLE_HTTP",
      config: { url: `${mockBase}/devstudio/mcp`, auth: { type: "oauth" } },
    });
    const id = res.body.server.id;
    const start = await owner.post(`/api/projects/${projectId}/mcp-servers/${id}/oauth/start`).expect(200);
    expect(new URL(start.body.authorizationUrl).searchParams.get("resource")).toBe(`${mockBase}/devstudio/mcp`);
    await owner.get(await consent(start.body.authorizationUrl)).expect(200);
    const who = await owner.post(`/api/projects/${projectId}/mcp-servers/${id}/tools/call`).send({ name: "whoami", args: {} });
    // no scope configured → the SDK requests every scope the resource advertises (MCP spec scope selection)
    expect(JSON.parse(who.body.text)).toEqual({ product: "DevStudio", scopes: ["projects:read", "tasks:read", "topics:read", "sprints:read", "tasks:write", "topics:write", "sprints:write"] });
  });
});
