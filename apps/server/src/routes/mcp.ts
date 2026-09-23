import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, type McpServer } from "@prisma/client";
import { mcpServerConfigSchema, mcpServerInputSchema, type McpCapabilities } from "@aieval/shared";
import { prisma } from "../db";
import { mcpManager, summarizeToolResult } from "../engine/mcp/manager";
import { disconnectOAuth, forgetOAuthCache, oauthInfo, oauthRedirectUrl, startOAuth } from "../engine/mcp/oauth";
import { loadSecrets } from "../engine/secrets";
import { HttpError, notFound, param, parseBody } from "../lib/http";
import { assertRole, projectId } from "../middleware/auth";

export const mcpRouter = Router({ mergeParams: true });

async function getServer(req: Request) {
  const server = await prisma.mcpServer.findFirst({ where: { id: param(req, "id"), projectId: projectId(req) } });
  if (!server) throw notFound("MCP server");
  return server;
}

const isOAuth = (server: Pick<McpServer, "config">) => mcpServerConfigSchema.safeParse(server.config ?? {}).data?.auth.type === "oauth";

/** What the browser may see: OAuth secrets and the pending state never leave the server. */
function publicServer(server: McpServer) {
  const { oauthData: _data, oauthState: _state, ...rest } = server;
  return { ...rest, oauth: oauthInfo(server) };
}

/** Connects, lists capabilities and stores the result as the server's health status. */
async function refresh(server: McpServer) {
  const started = Date.now();
  if (isOAuth(server) && server.oauthStatus !== "authorized") {
    // Nothing to connect with yet — don't spin up a background OAuth attempt.
    const updated = await prisma.mcpServer.update({ where: { id: server.id }, data: { status: "unknown", lastError: "Sign in to connect (OAuth 2.1)", lastCheckedAt: new Date() } });
    return { ok: false as const, needsAuth: true, latencyMs: 0, server: publicServer(updated), error: "Sign in to connect (OAuth 2.1)" };
  }
  const secrets = await loadSecrets(server.projectId);
  try {
    const caps = await mcpManager.capabilities(server, secrets);
    const updated = await prisma.mcpServer.update({
      where: { id: server.id },
      data: { status: "connected", lastError: null, lastCheckedAt: new Date(), capabilities: JSON.parse(JSON.stringify(caps)) },
    });
    return { ok: true as const, latencyMs: Date.now() - started, server: publicServer(updated), capabilities: caps };
  } catch (err) {
    await mcpManager.disconnect(server.id);
    const message = (err as Error).message;
    const updated = await prisma.mcpServer.update({ where: { id: server.id }, data: { status: "error", lastError: message, lastCheckedAt: new Date() } });
    return { ok: false as const, needsAuth: updated.oauthStatus === "needs_auth", latencyMs: Date.now() - started, server: publicServer(updated), error: message };
  }
}

mcpRouter.get("/", async (req, res) => {
  const servers = await prisma.mcpServer.findMany({ where: { projectId: projectId(req) }, orderBy: { name: "asc" } });
  res.json(
    servers.map((s) => {
      const caps = s.capabilities as McpCapabilities | null;
      return { ...publicServer(s), capabilities: undefined, counts: caps ? { tools: caps.tools.length, resources: caps.resources.length, prompts: caps.prompts.length } : null };
    }),
  );
});

/** The redirect URI to register when using a pre-registered OAuth client. */
mcpRouter.get("/oauth/redirect-uri", (_req, res) => {
  res.json({ redirectUri: oauthRedirectUrl() });
});

mcpRouter.post("/", async (req, res) => {
  assertRole(req, "EDITOR");
  const body = parseBody(mcpServerInputSchema, req);
  if (body.transport === "STDIO") assertRole(req, "OWNER");
  const server = await prisma.mcpServer.create({
    data: { projectId: projectId(req), name: body.name, description: body.description, transport: body.transport, config: body.config as Prisma.InputJsonValue },
  });
  const result = await refresh(server);
  res.status(201).json(result);
});

mcpRouter.get("/:id", async (req, res) => {
  res.json(publicServer(await getServer(req)));
});

mcpRouter.put("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const existing = await getServer(req);
  const body = parseBody(mcpServerInputSchema, req);
  if (body.transport === "STDIO" || existing.transport === "STDIO") assertRole(req, "OWNER");
  const before = mcpServerConfigSchema.parse(existing.config ?? {});
  // Tokens are bound to one resource (RFC 8707) and one client: a new URL, client or auth
  // mode makes the stored grant meaningless, so it is dropped rather than tried.
  const resetOAuth =
    before.url !== body.config.url || before.auth.type !== body.config.auth.type || before.auth.clientId !== body.config.auth.clientId || existing.transport !== body.transport;
  const server = await prisma.mcpServer.update({
    where: { id: existing.id },
    data: {
      name: body.name,
      description: body.description,
      transport: body.transport,
      config: body.config as Prisma.InputJsonValue,
      ...(resetOAuth && { oauthData: null, oauthStatus: "none", oauthState: null, oauthAuthorizedAt: null, oauthAuthorizedBy: null, oauthScope: null, oauthExpiresAt: null, oauthError: null }),
    },
  });
  if (resetOAuth) forgetOAuthCache(server.id);
  await mcpManager.disconnect(server.id);
  res.json(await refresh(server));
});

mcpRouter.delete("/:id", async (req, res) => {
  assertRole(req, "EDITOR");
  const server = await getServer(req);
  const users = await prisma.target.findMany({ where: { projectId: projectId(req) } });
  const usedBy = users.filter((t) => JSON.stringify(t.config).includes(`"${server.id}"`));
  if (usedBy.length) throw new HttpError(400, `Used by target(s): ${usedBy.map((t) => t.name).join(", ")}`);
  await mcpManager.disconnect(server.id);
  if (isOAuth(server)) await disconnectOAuth(server, await loadSecrets(server.projectId)).catch(() => {});
  forgetOAuthCache(server.id);
  await prisma.mcpServer.delete({ where: { id: server.id } });
  res.json({ ok: true });
});

/** Health check + capability refresh. */
mcpRouter.post("/:id/test", async (req, res) => {
  res.json(await refresh(await getServer(req)));
});

// ── OAuth 2.1 ────────────────────────────────────────────────────────────────

/** Starts sign-in; the browser opens the returned URL (popup) and lands on /api/mcp-oauth/callback. */
mcpRouter.post("/:id/oauth/start", async (req, res) => {
  assertRole(req, "EDITOR");
  const server = await getServer(req);
  if (!isOAuth(server)) throw new HttpError(400, "Set Authentication to OAuth 2.1 on this server first");
  await mcpManager.disconnect(server.id);
  try {
    const result = await startOAuth(server, await loadSecrets(server.projectId), req.user!.id);
    if (result.status === "authorized") return res.json({ status: "authorized", ...(await refresh(await getServer(req))) });
    res.json(result);
  } catch (err) {
    throw new HttpError(502, (err as Error).message);
  }
});

mcpRouter.post("/:id/oauth/disconnect", async (req, res) => {
  assertRole(req, "EDITOR");
  const server = await getServer(req);
  await mcpManager.disconnect(server.id);
  await disconnectOAuth(server, await loadSecrets(server.projectId));
  const updated = await prisma.mcpServer.update({ where: { id: server.id }, data: { status: "unknown", lastError: null } });
  res.json(publicServer(updated));
});

mcpRouter.post("/:id/disconnect", async (req, res) => {
  const server = await getServer(req);
  await mcpManager.disconnect(server.id);
  res.json({ ok: true });
});

mcpRouter.post("/:id/tools/call", async (req, res) => {
  assertRole(req, "EDITOR");
  const server = await getServer(req);
  const { name, args } = parseBody(z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) }), req);
  const secrets = await loadSecrets(server.projectId);
  const started = Date.now();
  try {
    const result = await mcpManager.callTool(server, secrets, name, args);
    const s = summarizeToolResult(result);
    res.json({ ok: true, latencyMs: Date.now() - started, result, text: s.text, json: s.json, isError: s.isError });
  } catch (err) {
    res.json({ ok: false, latencyMs: Date.now() - started, error: (err as Error).message });
  }
});

mcpRouter.post("/:id/resources/read", async (req, res) => {
  const server = await getServer(req);
  const { uri } = parseBody(z.object({ uri: z.string().min(1) }), req);
  const started = Date.now();
  try {
    const result = await mcpManager.readResource(server, await loadSecrets(server.projectId), uri);
    res.json({ ok: true, latencyMs: Date.now() - started, result });
  } catch (err) {
    res.json({ ok: false, latencyMs: Date.now() - started, error: (err as Error).message });
  }
});

mcpRouter.post("/:id/prompts/get", async (req, res) => {
  const server = await getServer(req);
  const { name, args } = parseBody(z.object({ name: z.string().min(1), args: z.record(z.string(), z.string()).default({}) }), req);
  const started = Date.now();
  try {
    const result = await mcpManager.getPrompt(server, await loadSecrets(server.projectId), name, args);
    res.json({ ok: true, latencyMs: Date.now() - started, result });
  } catch (err) {
    res.json({ ok: false, latencyMs: Date.now() - started, error: (err as Error).message });
  }
});
