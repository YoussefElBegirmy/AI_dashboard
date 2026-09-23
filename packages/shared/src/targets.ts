import { z } from "zod";

/**
 * Target = something the dashboard can send a test case to.
 * Every string field in these configs supports `{{path}}` templates over
 * `{ input, expected, secrets, steps }`.
 */

export const TARGET_KINDS = ["OPENROUTER_MODEL", "HTTP_ENDPOINT", "WORKFLOW", "MCP_TOOL"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  OPENROUTER_MODEL: "OpenRouter model",
  HTTP_ENDPOINT: "HTTP endpoint",
  WORKFLOW: "Workflow",
  MCP_TOOL: "MCP tool",
};

export const openRouterConfigSchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string().default(""),
  /** User message template. */
  promptTemplate: z.string().default("{{input.prompt}}"),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  responseFormat: z.enum(["text", "json_object"]).default("text"),
  /** Extra raw fields merged into the chat completion body (e.g. provider routing). */
  extraBody: z.record(z.string(), z.unknown()).default({}),
  /** MCP servers whose tools are exposed to the model (agent loop). */
  mcpServerIds: z.array(z.string()).default([]),
  /** Restrict to these tool names (`server__tool`); empty = all tools. */
  allowedTools: z.array(z.string()).default([]),
  maxToolIterations: z.number().int().min(1).max(50).default(8),
  /** Name of the project secret holding the OpenRouter key. */
  apiKeySecret: z.string().default("OPENROUTER_API_KEY"),
  timeoutMs: z.number().int().positive().default(120_000),
});
export type OpenRouterConfig = z.infer<typeof openRouterConfigSchema>;

export const httpConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({ "Content-Type": "application/json" }),
  query: z.record(z.string(), z.string()).default({}),
  bodyType: z.enum(["json", "text", "none"]).default("json"),
  /**
   * For bodyType=json: a JSON value whose string leaves are templates. A leaf that is
   * exactly "{{path}}" is replaced by the raw value (keeps objects / numbers intact).
   * For bodyType=text: a plain template string.
   */
  body: z.unknown().default({ input: "{{input}}" }),
  /** JSONPath into the response body used as the "output" to evaluate. Empty = whole body. */
  outputPath: z.string().default(""),
  /** Treat non-2xx responses as errors. Disable to evaluate error responses with assertions. */
  failOnHttpError: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(60_000),
});
export type HttpConfig = z.infer<typeof httpConfigSchema>;

export const workflowStepSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, digits and underscores"),
  targetId: z.string().min(1),
  /**
   * Input passed to the step's target (becomes its `input`). Deep-templated against
   * `{ input, expected, secrets, steps }`. Default passes the workflow input through.
   */
  input: z.unknown().default("{{input}}"),
  continueOnError: z.boolean().default(false),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowConfigSchema = z.object({
  steps: z.array(workflowStepSchema).min(1),
  /** Template for the final output. Empty = last step's output. */
  outputTemplate: z.string().default(""),
});
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export const mcpToolConfigSchema = z.object({
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  /** Tool arguments, deep-templated. */
  args: z.unknown().default({}),
  /** Optional JSONPath into structured content / parsed JSON text. */
  outputPath: z.string().default(""),
  /** Treat results with isError=true as errors. Disable to evaluate error results. */
  failOnToolError: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(60_000),
});
export type McpToolConfig = z.infer<typeof mcpToolConfigSchema>;

export const targetConfigSchemas = {
  OPENROUTER_MODEL: openRouterConfigSchema,
  HTTP_ENDPOINT: httpConfigSchema,
  WORKFLOW: workflowConfigSchema,
  MCP_TOOL: mcpToolConfigSchema,
} as const;

export type TargetConfigByKind = {
  OPENROUTER_MODEL: OpenRouterConfig;
  HTTP_ENDPOINT: HttpConfig;
  WORKFLOW: WorkflowConfig;
  MCP_TOOL: McpToolConfig;
};

export function parseTargetConfig<K extends TargetKind>(kind: K, config: unknown): TargetConfigByKind[K] {
  return targetConfigSchemas[kind].parse(config) as TargetConfigByKind[K];
}

export const targetInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  kind: z.enum(TARGET_KINDS),
  config: z.unknown(),
});

export const DEFAULT_TARGET_CONFIGS: Record<TargetKind, unknown> = {
  OPENROUTER_MODEL: {
    model: "openai/gpt-4o-mini",
    systemPrompt: "You are a helpful assistant.",
    promptTemplate: "{{input.prompt}}",
    temperature: 0,
    responseFormat: "text",
    extraBody: {},
    mcpServerIds: [],
    allowedTools: [],
    maxToolIterations: 8,
    apiKeySecret: "OPENROUTER_API_KEY",
    timeoutMs: 120000,
  },
  HTTP_ENDPOINT: {
    method: "POST",
    url: "http://localhost:3001/dev/mock/echo",
    headers: { "Content-Type": "application/json" },
    query: {},
    bodyType: "json",
    body: { message: "{{input.prompt}}" },
    outputPath: "$.reply",
    failOnHttpError: true,
    timeoutMs: 60000,
  },
  WORKFLOW: { steps: [], outputTemplate: "" },
  MCP_TOOL: { serverId: "", toolName: "", args: {}, outputPath: "", failOnToolError: true, timeoutMs: 60000 },
};
