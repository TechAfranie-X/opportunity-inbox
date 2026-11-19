import type { Transport } from "./hosted.ts";

/**
 * Local inference transport. The model runs in a process on this machine (an OpenAI-compatible server bound to loopback, e.g. `mlx_lm server`), so message
 * text never leaves the machine. This is enforced here and not just by convention: the endpoint must resolve to a loopback host, or construction throws.
 * Email text is untrusted input: the guide tells the model to treat it as data, and every output is verified against the message by lib/semantic/reading.ts.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function assertLoopback(baseUrl: string): URL {
  const u = new URL(baseUrl);
  if (!LOOPBACK.has(u.hostname)) throw new Error(`Local semantic reader refused: ${u.hostname} is not a loopback address, so text would leave this machine.`);
  return u;
}

export function localTransport(opts: { baseUrl?: string; maxTokens?: number; timeoutMs?: number } = {}): Transport {
  const base = assertLoopback(opts.baseUrl ?? "http://127.0.0.1:8089");
  return async ({ system, user, model }) => {
    const res = await fetch(new URL("/v1/chat/completions", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, temperature: 0, max_tokens: opts.maxTokens ?? 3000, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
    if (!res.ok) throw new Error(`local model server answered ${res.status}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? "";
  };
}
