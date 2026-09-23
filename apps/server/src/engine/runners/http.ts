import type { HttpConfig, RunnerOutput } from "@aieval/shared";
import { extractPath, render, renderDeep, renderRecord, toText } from "../template";
import { combineSignals, RunnerError, type RunContext } from "../types";

export async function runHttp(cfg: HttpConfig, ctx: RunContext): Promise<RunnerOutput> {
  const started = Date.now();
  const tctx = { input: ctx.input, expected: ctx.expected, secrets: ctx.secrets };

  const url = new URL(render(cfg.url, tctx));
  for (const [k, v] of Object.entries(renderRecord(cfg.query, tctx))) url.searchParams.set(k, v);
  const headers = renderRecord(cfg.headers, tctx);

  let body: string | undefined;
  if (cfg.method !== "GET" && cfg.bodyType !== "none") {
    body = cfg.bodyType === "json" ? JSON.stringify(renderDeep(cfg.body, tctx)) : render(toText(cfg.body), tctx);
  }

  let res: Response;
  try {
    res = await ctx.deps.fetch(url, { method: cfg.method, headers, body, signal: combineSignals(ctx.signal, cfg.timeoutMs) });
  } catch (err) {
    const e = err as Error;
    throw new RunnerError(e.name === "TimeoutError" ? `Timed out after ${cfg.timeoutMs}ms` : `Request failed: ${e.message}`, {
      latencyMs: Date.now() - started,
    });
  }
  const text = await res.text();
  const latencyMs = Date.now() - started;
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const raw = { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: json ?? text };

  if (!res.ok && cfg.failOnHttpError) {
    throw new RunnerError(`HTTP ${res.status}: ${text.slice(0, 300)}`, { raw, statusCode: res.status, latencyMs, output: text });
  }

  const extracted = cfg.outputPath ? extractPath(json, cfg.outputPath) : (json ?? text);
  if (cfg.outputPath && extracted === undefined) {
    throw new RunnerError(`outputPath ${cfg.outputPath} matched nothing in the response`, { raw, statusCode: res.status, latencyMs, output: text });
  }
  return {
    output: toText(extracted),
    outputJson: typeof extracted === "object" ? extracted : json,
    raw,
    statusCode: res.status,
    latencyMs,
  };
}
