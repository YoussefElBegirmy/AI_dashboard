import { env } from "../env";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | { type: string; text?: string }[];
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatCompletion {
  id?: string;
  model?: string;
  choices: { finish_reason?: string; message: ChatMessage }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
}

export async function chatCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  opts: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<ChatCompletion> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.appUrl,
      "X-Title": "AI Eval Dashboard",
    },
    body: JSON.stringify({ usage: { include: true }, ...body }),
    signal: opts.signal,
  });
  const text = await res.text();
  let json: ChatCompletion;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok || json.error) {
    throw new Error(`OpenRouter ${res.status}: ${json.error?.message ?? text.slice(0, 500)}`);
  }
  if (!json.choices?.length) throw new Error("OpenRouter returned no choices");
  return json;
}

export function messageText(msg: ChatMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) return msg.content.map((p) => p.text ?? "").join("");
  return "";
}

let modelsCache: { at: number; data: unknown } | null = null;

/** Public model catalog (no key needed), cached 10 minutes. */
export async function listModels(): Promise<unknown> {
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60_000) return modelsCache.data;
  const res = await fetch(`${OPENROUTER_BASE}/models`);
  if (!res.ok) throw new Error(`OpenRouter models HTTP ${res.status}`);
  const json = (await res.json()) as { data: unknown[] };
  modelsCache = { at: Date.now(), data: json.data };
  return json.data;
}
