import { z } from "zod";

export const MCP_TRANSPORTS = ["STREAMABLE_HTTP", "SSE", "STDIO"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  STREAMABLE_HTTP: "Streamable HTTP",
  SSE: "HTTP + SSE (legacy)",
  STDIO: "Local command (stdio)",
};

/**
 * How the dashboard authenticates to a remote MCP server.
 *  - none:  no auth, or static headers (e.g. `Authorization: Bearer {{secrets.X}}`)
 *  - oauth: MCP Authorization spec (OAuth 2.1 + PKCE). Discovery via RFC 9728 protected-resource
 *           metadata → RFC 8414 AS metadata, dynamic client registration (RFC 7591) unless a
 *           client id is given, RFC 8707 `resource` indicator, refresh-token rotation.
 */
export const MCP_AUTH_TYPES = ["none", "oauth"] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];

export const mcpAuthConfigSchema = z.object({
  type: z.enum(MCP_AUTH_TYPES).default("none"),
  /** Space-separated scopes to request. Empty = let the authorization server decide. */
  scope: z.string().max(1024).default(""),
  /** Shown on the provider's consent screen. */
  clientName: z.string().max(255).default("AI Eval Dashboard"),
  /** Pre-registered client id. Empty = dynamic client registration. */
  clientId: z.string().max(512).default(""),
  /** Name of a project secret holding the client secret (confidential clients only). */
  clientSecretName: z.string().max(128).default(""),
});
export type McpAuthConfig = z.infer<typeof mcpAuthConfigSchema>;

export const DEFAULT_MCP_AUTH: McpAuthConfig = { type: "none", scope: "", clientName: "AI Eval Dashboard", clientId: "", clientSecretName: "" };

/** Header / env values support `{{secrets.NAME}}`. */
export const mcpServerConfigSchema = z.object({
  url: z.string().default(""),
  headers: z.record(z.string(), z.string()).default({}),
  command: z.string().default(""),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().default(""),
  timeoutMs: z.number().int().positive().default(30_000),
  auth: mcpAuthConfigSchema.default(DEFAULT_MCP_AUTH),
});
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const mcpServerInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only (used as the tool prefix)"),
    description: z.string().max(2000).default(""),
    transport: z.enum(MCP_TRANSPORTS),
    config: mcpServerConfigSchema,
  })
  .superRefine((v, ctx) => {
    if (v.transport === "STDIO" && !v.config.command) {
      ctx.addIssue({ code: "custom", path: ["config", "command"], message: "Command is required for stdio" });
    }
    if (v.transport !== "STDIO" && !v.config.url) {
      ctx.addIssue({ code: "custom", path: ["config", "url"], message: "URL is required" });
    }
    if (v.transport === "STDIO" && v.config.auth.type === "oauth") {
      ctx.addIssue({ code: "custom", path: ["config", "auth", "type"], message: "OAuth applies to remote (HTTP) servers only" });
    }
  });

/** OAuth connection state as the API reports it (tokens are never sent to the browser). */
export type McpOAuthStatus = "none" | "authorized" | "needs_auth";

export interface McpOAuthInfo {
  status: McpOAuthStatus;
  authorizedAt: string | null;
  authorizedBy: string | null;
  scope: string | null;
  expiresAt: string | null;
  clientId: string | null;
  authorizationServer: string | null;
  lastError: string | null;
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpCapabilities {
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  instructions?: string;
  tools: McpToolInfo[];
  resources: { uri: string; name?: string; description?: string; mimeType?: string }[];
  resourceTemplates: { uriTemplate: string; name?: string; description?: string }[];
  prompts: { name: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }[];
}

/** OpenAI-compatible tool names must match ^[a-zA-Z0-9_-]{1,64}$. */
export function mcpToolAlias(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
