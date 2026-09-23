import { describe, expect, it, vi } from "vitest";
import type { McpCapabilities } from "@aieval/shared";
import { runTarget } from "../runners";
import type { EngineDeps, RunContext, TargetLike } from "../types";

const server = { id: "srv1", projectId: "p1", name: "kb", transport: "STDIO" as const, config: {}, updatedAt: new Date() };
const caps: McpCapabilities = {
  tools: [{ name: "search", description: "Search the KB", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
  resources: [],
  resourceTemplates: [],
  prompts: [],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type FetchMock = ReturnType<typeof vi.fn>;

function makeCtx(targets: TargetLike[], fetchImpl: FetchMock | typeof fetch): RunContext {
  const deps: EngineDeps = {
    fetch: fetchImpl as unknown as typeof fetch,
    loadTarget: async (_p, id) => targets.find((t) => t.id === id) ?? null,
    loadMcpServer: async (_p, id) => (id === server.id ? server : null),
    mcp: {
      capabilities: vi.fn().mockResolvedValue(caps),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Refunds within 30 days." }] }),
    } as unknown as EngineDeps["mcp"],
  };
  return { projectId: "p1", secrets: { OPENROUTER_API_KEY: "or-key", API: "abc" }, input: { question: "What is the refund policy?" }, expected: null, depth: 0, deps };
}

describe("runners", () => {
  it("HTTP runner templates the request and extracts the output path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ data: { answer: "42" } }));
    const target: TargetLike = {
      id: "h",
      projectId: "p1",
      name: "api",
      kind: "HTTP_ENDPOINT",
      config: { url: "https://api.test/ask", headers: { Authorization: "Bearer {{secrets.API}}" }, body: { q: "{{input.question}}", raw: "{{input}}" }, outputPath: "$.data.answer" },
    };
    const out = await runTarget(target, makeCtx([target], fetchImpl));
    expect(out.output).toBe("42");
    expect(out.statusCode).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.test/ask");
    expect(init.headers.Authorization).toBe("Bearer abc");
    expect(JSON.parse(init.body)).toEqual({ q: "What is the refund policy?", raw: { question: "What is the refund policy?" } });
  });

  it("HTTP runner treats non-2xx as an error unless disabled", async () => {
    const target: TargetLike = { id: "h", projectId: "p1", name: "api", kind: "HTTP_ENDPOINT", config: { url: "https://api.test/x" } };
    await expect(runTarget(target, makeCtx([target], vi.fn().mockResolvedValue(json({ error: "boom" }, 500))))).rejects.toThrow(/HTTP 500/);
    const lenient: TargetLike = { ...target, config: { url: "https://api.test/x", failOnHttpError: false } };
    const out = await runTarget(lenient, makeCtx([lenient], vi.fn().mockResolvedValue(json({ error: "boom" }, 500))));
    expect(out.statusCode).toBe(500);
  });

  it("OpenRouter runner runs an MCP tool loop and records tool calls and usage", async () => {
    const replies = [
      {
        choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "kb__search", arguments: '{"query":"refund"}' } }] } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, cost: 0.001 },
      },
      { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Refunds are accepted within 30 days." } }], usage: { prompt_tokens: 80, completion_tokens: 12, cost: 0.002 } },
    ];
    const fetchImpl = vi.fn().mockImplementation(async () => json(replies.shift()));
    const target: TargetLike = {
      id: "m",
      projectId: "p1",
      name: "model",
      kind: "OPENROUTER_MODEL",
      config: { model: "openai/gpt-4o-mini", promptTemplate: "{{input.question}}", mcpServerIds: ["srv1"] },
    };
    const ctx = makeCtx([target], fetchImpl);
    const out = await runTarget(target, ctx);

    expect(out.output).toBe("Refunds are accepted within 30 days.");
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls![0]).toMatchObject({ alias: "kb__search", server: "kb", tool: "search", args: { query: "refund" }, isError: false });
    expect(out.usage?.inputTokens).toBe(130);
    expect(out.usage?.outputTokens).toBe(22);
    expect(out.usage?.costUsd).toBeCloseTo(0.003);
    expect(ctx.deps.mcp.callTool).toHaveBeenCalledWith(server, ctx.secrets, "search", { query: "refund" }, expect.anything());

    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(firstBody.tools[0].function.name).toBe("kb__search");
    expect(firstBody.messages.at(-1)).toEqual({ role: "user", content: "What is the refund policy?" });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer or-key");
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1", content: "Refunds within 30 days." });
  });

  it("OpenRouter runner stops after maxToolIterations", async () => {
    const loop = { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "kb__search", arguments: "{}" } }] } }] };
    const fetchImpl = vi.fn().mockImplementation(async () => json(loop));
    const target: TargetLike = { id: "m", projectId: "p1", name: "model", kind: "OPENROUTER_MODEL", config: { model: "x/y", mcpServerIds: ["srv1"], maxToolIterations: 2 } };
    await expect(runTarget(target, makeCtx([target], fetchImpl))).rejects.toThrow(/2 tool iterations/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("OpenRouter runner fails clearly without an API key", async () => {
    const target: TargetLike = { id: "m", projectId: "p1", name: "model", kind: "OPENROUTER_MODEL", config: { model: "x/y" } };
    const ctx = makeCtx([target], vi.fn());
    ctx.secrets = {};
    await expect(runTarget(target, ctx)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("MCP tool runner templates arguments", async () => {
    const target: TargetLike = { id: "t", projectId: "p1", name: "tool", kind: "MCP_TOOL", config: { serverId: "srv1", toolName: "search", args: { query: "{{input.question}}" } } };
    const ctx = makeCtx([target], vi.fn());
    const out = await runTarget(target, ctx);
    expect(out.output).toBe("Refunds within 30 days.");
    expect(ctx.deps.mcp.callTool).toHaveBeenCalledWith(server, ctx.secrets, "search", { query: "What is the refund policy?" }, expect.anything(), 60000);
  });

  it("workflow chains steps and exposes earlier outputs", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return json({ text: `<${body.text}>` });
    });
    const step: TargetLike = { id: "s", projectId: "p1", name: "wrap", kind: "HTTP_ENDPOINT", config: { url: "https://x.test", body: { text: "{{input.text}}" }, outputPath: "$.text" } };
    const wf: TargetLike = {
      id: "w",
      projectId: "p1",
      name: "wf",
      kind: "WORKFLOW",
      config: {
        steps: [
          { name: "one", targetId: "s", input: { text: "{{input.question}}" } },
          { name: "two", targetId: "s", input: { text: "{{steps.one.output}}" } },
        ],
        outputTemplate: "{{steps.one.output}} | {{steps.two.output}}",
      },
    };
    const out = await runTarget(wf, makeCtx([step, wf], fetchImpl));
    expect(out.output).toBe("<What is the refund policy?> | <<What is the refund policy?>>");
    expect(out.trace?.map((t) => t.name)).toEqual(["one", "two"]);
  });

  it("workflow failure keeps the partial trace", async () => {
    const bad: TargetLike = { id: "b", projectId: "p1", name: "bad", kind: "HTTP_ENDPOINT", config: { url: "https://x.test" } };
    const wf: TargetLike = { id: "w", projectId: "p1", name: "wf", kind: "WORKFLOW", config: { steps: [{ name: "s1", targetId: "b" }] } };
    const err = await runTarget(wf, makeCtx([bad, wf], vi.fn().mockResolvedValue(json({}, 503)))).catch((e) => e);
    expect(err.message).toMatch(/Step "s1" failed/);
    expect(err.partial.trace[0]).toMatchObject({ name: "s1", error: expect.stringMatching(/503/) });
  });
});
