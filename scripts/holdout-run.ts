/**
 * Runs BOTH semantic readers (A = production input, B = context-separated) on the frozen holdout draw with the local model, and stores only their structured answers (ids, recruiting, type, certainty,
 * status) outside the repository. Refuses to run if the draw differs from docs/holdout-draw.sha256. Read-only on Gmail. Nothing is stored in the database.
 *   node ... scripts/holdout-run.ts <googleSub>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { SEMANTIC_GUIDE_V4 } from "../lib/semantic/guide-v4.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { localTransport } from "../lib/semantic/local.ts";
const sub = process.argv[2]; const dir = `${homedir()}/.opportunity-inbox-validation/holdout-v1`;
const raw = readFileSync(`${dir}/draw.json`, "utf8");
if (createHash("sha256").update(raw).digest("hex") !== readFileSync("docs/holdout-draw.sha256", "utf8").split(/\s+/)[0]) { console.error("REFUSED: the draw differs from the recorded hash"); process.exit(2); }
const draw = JSON.parse(raw) as { items: { id: string; stratum: string }[] };
const emails: Awaited<ReturnType<typeof fetchEmailsById>>["emails"] = [];
for (let i = 0; i < draw.items.length; i += 20) { const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!); emails.push(...(await fetchEmailsById(token, draw.items.slice(i, i + 20).map((x) => x.id))).emails); }
const mk = (guide: string) => createModelReader({ transport: localTransport(), model: "mlx-community/Qwen3-4B-Instruct-2507-4bit", batch: 4, idPrefix: "holdout", guide });
const slim = (m: Map<string, { output: { status: string; recruiting: boolean; type: string | null; certainty: string } }>) => Object.fromEntries([...m].map(([k, v]) => [k, { status: v.output.status, recruiting: v.output.recruiting, type: v.output.type, certainty: v.output.certainty }]));
const t0 = Date.now();
const A = await mk(SEMANTIC_GUIDE_V3_COMPACT).readings!(semanticInputs(emails, [], { parts: false }));
const B = await mk(SEMANTIC_GUIDE_V4).readings!(semanticInputs(emails, [], { parts: true }));
writeFileSync(`${dir}/readings.json`, JSON.stringify({ drawHash: createHash("sha256").update(raw).digest("hex"), ranAt: new Date().toISOString(), fetched: emails.length, A: slim(A), B: slim(B) }));
console.log(`holdout readings stored: fetched ${emails.length}/${draw.items.length}, A answered ${A.size}, B answered ${B.size}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(0);
