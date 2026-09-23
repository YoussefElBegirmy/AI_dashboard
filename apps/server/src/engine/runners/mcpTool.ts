import type { McpToolConfig, RunnerOutput, ToolCallRecord } from "@aieval/shared";
import { summarizeToolResult } from "../mcp/manager";
import { extractPath, renderDeep, toText } from "../template";
import { combineSignals, RunnerError, type RunContext } from "../types";

export async function runMcpTool(cfg: McpToolConfig, ctx: RunContext): Promise<RunnerOutput> {
  const started = Date.now();
  const server = await ctx.deps.loadMcpServer(ctx.projectId, cfg.serverId);
  if (!server) throw new RunnerError(`MCP server ${cfg.serverId} not found`);
  const args = renderDeep(cfg.args, { input: ctx.input, expected: ctx.expected, secrets: ctx.secrets });

  let result: unknown;
  try {
    result = await ctx.deps.mcp.callTool(server, ctx.secrets, cfg.toolName, args, combineSignals(ctx.signal, cfg.timeoutMs), cfg.timeoutMs);
  } catch (err) {
    throw new RunnerError(`MCP call failed: ${(err as Error).message}`, { latencyMs: Date.now() - started });
  }
  const latencyMs = Date.now() - started;
  const s = summarizeToolResult(result);
  const toolCalls: ToolCallRecord[] = [
    { alias: cfg.toolName, server: server.name, tool: cfg.toolName, args, result, isError: s.isError, latencyMs },
  ];
  if (s.isError && cfg.failOnToolError) {
    throw new RunnerError(`Tool returned an error: ${s.text.slice(0, 300)}`, { raw: result, toolCalls, latencyMs, output: s.text });
  }
  const extracted = cfg.outputPath ? extractPath(s.json, cfg.outputPath) : undefined;
  return {
    output: cfg.outputPath ? toText(extracted) : s.text,
    outputJson: cfg.outputPath ? extracted : s.json,
    raw: result,
    latencyMs,
    toolCalls,
  };
}
