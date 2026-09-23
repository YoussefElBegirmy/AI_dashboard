import { mcpToolAlias, type OpenRouterConfig, type RunnerOutput, type ToolCallRecord } from "@aieval/shared";
import { summarizeToolResult, type McpServerLike } from "../mcp/manager";
import { chatCompletion, messageText, type ChatCompletion, type ChatMessage } from "../openrouter";
import { requireSecret } from "../secrets";
import { render, tryParseJson, toText } from "../template";
import { combineSignals, RunnerError, type RunContext } from "../types";

interface ToolBinding {
  server: McpServerLike;
  tool: string;
}

async function collectTools(cfg: OpenRouterConfig, ctx: RunContext) {
  const bindings = new Map<string, ToolBinding>();
  const tools: unknown[] = [];
  for (const serverId of cfg.mcpServerIds) {
    const server = await ctx.deps.loadMcpServer(ctx.projectId, serverId);
    if (!server) throw new Error(`MCP server ${serverId} not found`);
    const caps = await ctx.deps.mcp.capabilities(server, ctx.secrets);
    for (const t of caps.tools) {
      const alias = mcpToolAlias(server.name, t.name);
      if (cfg.allowedTools.length && !cfg.allowedTools.includes(alias) && !cfg.allowedTools.includes(t.name)) continue;
      bindings.set(alias, { server, tool: t.name });
      tools.push({
        type: "function",
        function: {
          name: alias,
          description: (t.description ?? t.title ?? "").slice(0, 1024),
          parameters: t.inputSchema && Object.keys(t.inputSchema).length ? t.inputSchema : { type: "object", properties: {} },
        },
      });
    }
  }
  return { bindings, tools };
}

export async function runOpenRouter(cfg: OpenRouterConfig, ctx: RunContext): Promise<RunnerOutput> {
  const started = Date.now();
  const apiKey = requireSecret(ctx.secrets, cfg.apiKeySecret);
  const tctx = { input: ctx.input, expected: ctx.expected, secrets: ctx.secrets };

  const messages: ChatMessage[] = [];
  if (cfg.systemPrompt) messages.push({ role: "system", content: render(cfg.systemPrompt, tctx) });
  let user = render(cfg.promptTemplate, tctx);
  if (!user.trim()) user = toText(ctx.input);
  messages.push({ role: "user", content: user });

  const { bindings, tools } = await collectTools(cfg, ctx);
  const toolCalls: ToolCallRecord[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let last: ChatCompletion | undefined;
  let finalText = "";
  const signal = combineSignals(ctx.signal, cfg.timeoutMs);

  const fail = (msg: string) =>
    new RunnerError(msg, { toolCalls, usage, latencyMs: Date.now() - started, raw: { messages, lastResponse: last } });

  try {
    for (let iteration = 0; ; iteration++) {
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages,
        ...(cfg.temperature !== undefined && { temperature: cfg.temperature }),
        ...(cfg.maxTokens !== undefined && { max_tokens: cfg.maxTokens }),
        ...(cfg.topP !== undefined && { top_p: cfg.topP }),
        ...(cfg.responseFormat === "json_object" && { response_format: { type: "json_object" } }),
        ...(tools.length && { tools }),
        ...cfg.extraBody,
      };
      last = await chatCompletion(apiKey, body, { signal, fetch: ctx.deps.fetch });
      usage.inputTokens += last.usage?.prompt_tokens ?? 0;
      usage.outputTokens += last.usage?.completion_tokens ?? 0;
      usage.costUsd += last.usage?.cost ?? 0;

      const msg = last.choices[0].message;
      messages.push({ role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length && { tool_calls: msg.tool_calls }) });

      if (!msg.tool_calls?.length || !tools.length) {
        finalText = messageText(msg);
        break;
      }
      if (iteration >= cfg.maxToolIterations) {
        finalText = messageText(msg);
        throw fail(`Stopped after ${cfg.maxToolIterations} tool iterations without a final answer`);
      }

      for (const call of msg.tool_calls) {
        const binding = bindings.get(call.function.name);
        const t0 = Date.now();
        let args: unknown = {};
        let content: string;
        let record: ToolCallRecord;
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = { _raw: call.function.arguments };
        }
        if (!binding) {
          content = `Error: unknown tool ${call.function.name}`;
          record = { alias: call.function.name, server: "", tool: call.function.name, args, result: content, isError: true, latencyMs: 0 };
        } else {
          try {
            const result = await ctx.deps.mcp.callTool(binding.server, ctx.secrets, binding.tool, args, signal);
            const s = summarizeToolResult(result);
            content = s.text || JSON.stringify(result);
            record = { alias: call.function.name, server: binding.server.name, tool: binding.tool, args, result, isError: s.isError, latencyMs: Date.now() - t0 };
          } catch (err) {
            content = `Error: ${(err as Error).message}`;
            record = { alias: call.function.name, server: binding.server.name, tool: binding.tool, args, result: content, isError: true, latencyMs: Date.now() - t0 };
          }
        }
        toolCalls.push(record);
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
  } catch (err) {
    if (err instanceof RunnerError) throw err;
    throw fail((err as Error).message);
  }

  return {
    output: finalText,
    outputJson: tryParseJson(finalText),
    raw: { model: last?.model, id: last?.id, finish_reason: last?.choices[0]?.finish_reason, messages },
    latencyMs: Date.now() - started,
    usage,
    toolCalls,
  };
}
