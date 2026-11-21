/**
 * Fill the cached model readings for a fixture WITHOUT evaluating it: the model is called once per scenario and the verified readings are saved, nothing is scored, nothing is
 * printed about the fixture's content or results. Used for a sealed fixture so its readings can be replayed later, once, with the final logic.
 *   node --env-file=.env.local --no-warnings --import ./scripts/loader/register.mjs scripts/fill-reading-cache.ts <fixture.json> <cache.json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { RecruitingEmail } from "../lib/recruiting/types.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { localTransport } from "../lib/semantic/local.ts";

const [file, cachePath] = process.argv.slice(2);
if (!file || !cachePath) { console.error("usage: fill-reading-cache.ts <fixture.json> <cache.json>"); process.exit(2); }
type Msg = { id: string; threadId?: string; from: string; subject: string; body: string; receivedAt: string; outbound?: boolean };
const fx = JSON.parse(readFileSync(file, "utf8")) as { scenarios: { id: string; messages: Msg[] }[] };
const cache: Record<string, [string, unknown][]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const reader = createModelReader({ transport: localTransport(), model: "mlx-community/Qwen3-4B-Instruct-2507-4bit", batch: 4, idPrefix: "local", guide: SEMANTIC_GUIDE_V3_COMPACT });
let done = 0;
for (const sc of fx.scenarios) {
  if (cache[sc.id]) { done++; continue; }
  const emails: RecruitingEmail[] = sc.messages.map((m) => ({ id: m.id, threadId: m.threadId ?? `t-${m.id}`, from: m.from, subject: m.subject, bodyText: m.body, receivedAt: new Date(m.receivedAt), outbound: m.outbound ?? false }));
  const readings = await reader.readings!(semanticInputs(emails));
  cache[sc.id] = [...readings.entries()] as [string, unknown][];
  writeFileSync(cachePath, JSON.stringify(cache));
  done++;
  console.log(`scenario ${done}/${fx.scenarios.length} read (${readings.size} readings)`);
}
console.log("cache complete");
