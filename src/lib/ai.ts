/**
 * ai — OpenRouter. Two lanes:
 *  - FAST (qwen3.7-flash, reasoning off, JSON schema): quizzes, grading, filtering a
 *    blog index by topic. Cheap, a few seconds. Falls back to DeepSeek once.
 *  - CHAT (Claude Sonnet 5 by default, the reader can switch): the reading assistant,
 *    streamed.
 */
export type Msg = { role: "system" | "user" | "assistant"; content: string };

const KEY = () => process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || "";
export const hasKey = () => !!KEY();
export const FAST = process.env.AI_MODEL_FAST || "qwen/qwen3.7-flash";
const FAST_FALLBACK = process.env.AI_MODEL_FALLBACK || "deepseek/deepseek-v4.1-flash";
export const CHAT_MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash" },
];
export const CHAT_DEFAULT = process.env.AI_MODEL_CHAT || CHAT_MODELS[0].id;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function headers() {
  return {
    authorization: `Bearer ${KEY()}`,
    "content-type": "application/json",
    "http-referer": process.env.PUBLIC_URL || "https://madhudream.dev",
    "x-title": "Madhu LMS - reading room",
  };
}

async function once(model: string, messages: Msg[], schema: { name: string; schema: object } | null, maxTokens: number): Promise<string> {
  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens, temperature: 0.3, reasoning: { enabled: false } };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: schema.name, strict: true, schema: schema.schema } };
  const r = await fetch(ENDPOINT, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content?.trim() || "";
}

/** structured output from the fast lane; null when both models fail */
export async function json<T>(messages: Msg[], schema: { name: string; schema: object }, maxTokens = 2000): Promise<T | null> {
  if (!hasKey()) return null;
  for (const model of [FAST, FAST_FALLBACK]) {
    try {
      const text = await once(model, messages, schema, maxTokens);
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]) as T;
    } catch (e) { console.warn(`[ai] ${model}:`, (e as Error).message); }
  }
  return null;
}

export async function text(messages: Msg[], maxTokens = 800): Promise<string> {
  if (!hasKey()) return "";
  for (const model of [FAST, FAST_FALLBACK]) {
    try { const t = await once(model, messages, null, maxTokens); if (t) return t; } catch { /* next */ }
  }
  return "";
}

/** streams the assistant's reply as plain text chunks; resolves with the whole reply */
export async function stream(model: string, messages: Msg[], onChunk: (s: string) => void, signal?: AbortSignal): Promise<string> {
  const allowed = CHAT_MODELS.some((m) => m.id === model) ? model : CHAT_DEFAULT;
  const r = await fetch(ENDPOINT, {
    method: "POST", headers: headers(), signal,
    body: JSON.stringify({ model: allowed, messages, stream: true, max_tokens: 4000, temperature: 0.5 }),
  });
  if (!r.ok || !r.body) throw new Error(`openrouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", all = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return all;
      try {
        const piece = JSON.parse(data).choices?.[0]?.delta?.content;
        if (piece) { all += piece; onChunk(piece); }
      } catch { /* keep-alive comments */ }
    }
  }
  return all;
}
