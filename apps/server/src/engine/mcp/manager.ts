import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mcpServerConfigSchema, type McpCapabilities, type McpServerConfig, type McpTransport } from "@aieval/shared";
import { render, renderRecord } from "../template";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { createAuthProvider, McpAuthRequiredError, oauthFetch } from "./oauth";

export interface McpServerLike {
  id: string;
  projectId: string;
  name: string;
  transport: McpTransport;
  config: unknown;
  updatedAt: Date;
}

interface PoolEntry {
  key: string;
  client: Client;
  transport: Transport;
  lastUsed: number;
  stderr: string[];
}

const IDLE_MS = 10 * 60_000;

function resolveConfig(server: McpServerLike, secrets: Record<string, string>): McpServerConfig {
  const cfg = mcpServerConfigSchema.parse(server.config ?? {});
  const ctx = { secrets };
  return {
    ...cfg,
    url: render(cfg.url, ctx),
    headers: renderRecord(cfg.headers, ctx),
    command: render(cfg.command, ctx),
    args: cfg.args.map((a) => render(a, ctx)),
    env: renderRecord(cfg.env, ctx),
    cwd: render(cfg.cwd, ctx),
  };
}

/**
 * Pooled MCP client connections, one per server. A connection is re-created when the
 * server record (or a secret it references) changes, and closed after being idle.
 */
export class McpManager {
  private pool = new Map<string, PoolEntry>();
  private pending = new Map<string, Promise<PoolEntry>>();
  private timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  private async open(server: McpServerLike, cfg: McpServerConfig, key: string, secrets: Record<string, string>): Promise<PoolEntry> {
    const stderr: string[] = [];
    let transport: Transport;
    if (server.transport === "STDIO") {
      const t = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...getDefaultEnvironment(), ...cfg.env },
        cwd: cfg.cwd || undefined,
        stderr: "pipe",
      });
      t.stderr?.on("data", (chunk: Buffer) => {
        stderr.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
        if (stderr.length > 50) stderr.splice(0, stderr.length - 50);
      });
      transport = t;
    } else {
      const url = new URL(cfg.url);
      const requestInit = { headers: cfg.headers };
      // OAuth 2.1: the SDK attaches the bearer, and on a 401 refreshes (or reports that a
      // person must sign in again) through the provider.
      const oauth = cfg.auth.type === "oauth" ? { authProvider: await createAuthProvider(server, secrets), fetch: oauthFetch } : {};
      transport =
        server.transport === "SSE"
          ? new SSEClientTransport(url, { requestInit, ...oauth })
          : new StreamableHTTPClientTransport(url, { requestInit, ...oauth });
    }

    const client = new Client({ name: "ai-eval-dashboard", version: "0.1.0" });
    const entry: PoolEntry = { key, client, transport, lastUsed: Date.now(), stderr };
    client.onclose = () => {
      if (this.pool.get(server.id) === entry) this.pool.delete(server.id);
    };
    try {
      await client.connect(transport, { timeout: cfg.timeoutMs });
    } catch (err) {
      await client.close().catch(() => {});
      if (err instanceof UnauthorizedError || (err as { code?: number }).code === 401) {
        throw cfg.auth.type === "oauth"
          ? new McpAuthRequiredError()
          : new Error(`${(err as Error).message} — the server requires authentication (add headers, or switch Authentication to OAuth 2.1)`);
      }
      const tail = stderr.slice(-5).join("\n");
      throw new Error(`${(err as Error).message}${tail ? `\n--- server stderr ---\n${tail}` : ""}`);
    }
    return entry;
  }

  private async get(server: McpServerLike, secrets: Record<string, string>): Promise<{ entry: PoolEntry; cfg: McpServerConfig }> {
    const cfg = resolveConfig(server, secrets);
    const key = createHash("sha256")
      .update(JSON.stringify([server.transport, cfg, server.updatedAt.toISOString()]))
      .digest("hex");
    const existing = this.pool.get(server.id);
    if (existing && existing.key === key) {
      existing.lastUsed = Date.now();
      return { entry: existing, cfg };
    }
    if (existing) await this.disconnect(server.id);

    const pendingKey = `${server.id}:${key}`;
    let p = this.pending.get(pendingKey);
    if (!p) {
      p = this.open(server, cfg, key, secrets).finally(() => this.pending.delete(pendingKey));
      this.pending.set(pendingKey, p);
    }
    const entry = await p;
    this.pool.set(server.id, entry);
    return { entry, cfg };
  }

  /** Runs `fn` with a connected client, reconnecting once if the connection dropped. */
  async withClient<T>(server: McpServerLike, secrets: Record<string, string>, fn: (c: Client, cfg: McpServerConfig) => Promise<T>): Promise<T> {
    const { entry, cfg } = await this.get(server, secrets);
    try {
      return await fn(entry.client, cfg);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (err instanceof UnauthorizedError) {
        // refresh failed mid-session — drop the connection so the next call starts clean
        await this.disconnect(server.id);
        throw cfg.auth.type === "oauth" ? new McpAuthRequiredError() : err;
      }
      if (/closed|not connected|ECONNRESET|EPIPE|terminated/i.test(msg)) {
        await this.disconnect(server.id);
        const again = await this.get(server, secrets);
        return fn(again.entry.client, again.cfg);
      }
      throw err;
    }
  }

  async capabilities(server: McpServerLike, secrets: Record<string, string>): Promise<McpCapabilities> {
    return this.withClient(server, secrets, async (client, cfg) => {
      const opts = { timeout: cfg.timeoutMs };
      const caps = client.getServerCapabilities() ?? {};
      const tools: McpCapabilities["tools"] = [];
      if (caps.tools) {
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined, opts);
          tools.push(...(page.tools as McpCapabilities["tools"]));
          cursor = page.nextCursor;
        } while (cursor);
      }
      const resources = caps.resources ? ((await client.listResources(undefined, opts).catch(() => ({ resources: [] }))).resources as McpCapabilities["resources"]) : [];
      const resourceTemplates = caps.resources
        ? ((await client.listResourceTemplates(undefined, opts).catch(() => ({ resourceTemplates: [] }))).resourceTemplates as McpCapabilities["resourceTemplates"])
        : [];
      const prompts = caps.prompts ? ((await client.listPrompts(undefined, opts).catch(() => ({ prompts: [] }))).prompts as McpCapabilities["prompts"]) : [];
      const info = client.getServerVersion();
      return {
        serverInfo: info ? { name: info.name, version: info.version } : undefined,
        instructions: client.getInstructions(),
        tools,
        resources,
        resourceTemplates,
        prompts,
      };
    });
  }

  async callTool(server: McpServerLike, secrets: Record<string, string>, name: string, args: unknown, signal?: AbortSignal, timeoutMs?: number) {
    return this.withClient(server, secrets, (client, cfg) =>
      client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> }, undefined, {
        timeout: timeoutMs ?? cfg.timeoutMs,
        signal,
      }),
    );
  }

  async readResource(server: McpServerLike, secrets: Record<string, string>, uri: string) {
    return this.withClient(server, secrets, (client, cfg) => client.readResource({ uri }, { timeout: cfg.timeoutMs }));
  }

  async getPrompt(server: McpServerLike, secrets: Record<string, string>, name: string, args: Record<string, string>) {
    return this.withClient(server, secrets, (client, cfg) => client.getPrompt({ name, arguments: args }, { timeout: cfg.timeoutMs }));
  }

  async disconnect(serverId: string) {
    const entry = this.pool.get(serverId);
    this.pool.delete(serverId);
    if (entry) await entry.client.close().catch(() => {});
  }

  private sweep() {
    const now = Date.now();
    for (const [id, entry] of this.pool) if (now - entry.lastUsed > IDLE_MS) void this.disconnect(id);
  }

  async closeAll() {
    clearInterval(this.timer);
    await Promise.all([...this.pool.keys()].map((id) => this.disconnect(id)));
  }
}

export const mcpManager = new McpManager();

/** Flattens an MCP CallToolResult into text + best-effort JSON. */
export function summarizeToolResult(result: unknown): { text: string; json: unknown; isError: boolean } {
  const r = (result ?? {}) as { content?: { type: string; text?: string; resource?: { text?: string } }[]; structuredContent?: unknown; isError?: boolean; toolResult?: unknown };
  if (r.toolResult !== undefined) {
    return { text: typeof r.toolResult === "string" ? r.toolResult : JSON.stringify(r.toolResult), json: r.toolResult, isError: false };
  }
  const parts = (r.content ?? []).map((c) => {
    if (c.type === "text") return c.text ?? "";
    if (c.type === "resource") return c.resource?.text ?? "[resource]";
    return `[${c.type}]`;
  });
  const text = parts.join("\n");
  let json: unknown = r.structuredContent;
  if (json === undefined) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { text, json, isError: Boolean(r.isError) };
}
