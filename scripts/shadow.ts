// Architecture v2 shadow-mode operations. Nothing here changes what the product shows.
//   npm run shadow -- collect --user <sub|hash6> [--limit 150]      list v2 candidates, store routing + rules reading (no text)
//   npm run shadow -- export  --user <sub|hash6> --out <dir outside repo> [--batch 56] [--max 300]
//        re-fetches the pending messages, writes redacted model inputs to <dir>; a worker reads <dir>/batch-N.jsonl + guide.md
//        and writes <dir>/out-N.jsonl  (the existing development worker mechanism; no external API)
//   npm run shadow -- import  --dir <dir> [--delete]                 verify outputs, resolve, store; --delete removes <dir>
//   npm run shadow -- report  [--user <sub|hash6>]                   content-free old-vs-v2 comparison
//   npm run shadow -- review  --user <sub|hash6>                     open human-review items, counts by reason
// Redaction names come from READER_SELF_NAMES (.env.local). Model inputs exist only in <dir> and are deleted after import.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { gmailConnections } from "../lib/db/schema.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { writePrivateFile } from "../lib/eval-store/private-fs.ts";
import { OUTPUT_SPEC } from "../lib/recruiting/reader/guide.ts";
import { GUIDE_V3, READER_VERSION_V3 } from "../lib/recruiting/reader/guide3.ts";
import type { ReaderInput } from "../lib/recruiting/reader/types.ts";
import { auditGrounding, verifyOutput } from "../lib/recruiting/reader/verify.ts";
import { collectShadow } from "../lib/recruiting/shadow/collect.ts";
import { buildShadowInput, shadowKey } from "../lib/recruiting/shadow/input.ts";
import { formatSummary, summarize } from "../lib/recruiting/shadow/report.ts";
import { resolveRecord } from "../lib/recruiting/shadow/shadow.ts";
import { getShadowRecord, pendingModelReads, reportRows, reviewItems, saveResolution } from "../lib/recruiting/shadow/store.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = new Map<string, string>();
for (let i = 1; i < argv.length; i += 1) if (argv[i].startsWith("--")) args.set(argv[i].slice(2), argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
const need = (k: string) => args.get(k) ?? (console.error(`missing --${k}`), process.exit(1));
const fail = (m: string): never => { console.error(`error: ${m}`); process.exit(1); };
const label = (sub: string) => createHash("md5").update(sub).digest("hex").slice(0, 6);

/** Accepts a full subject id or the 6-character hash prefix used in the audit tooling, so ids need not be typed or printed. */
async function resolveUser(v: string): Promise<string> {
  const rows = await getDb().select({ s: gmailConnections.userGoogleSub }).from(gmailConnections).where(v.length === 6 ? sql`left(md5(${gmailConnections.userGoogleSub}),6)=${v}` : sql`${gmailConnections.userGoogleSub}=${v}`);
  return rows.length === 1 ? rows[0].s : fail(`${rows.length} Gmail connections match --user`);
}

if (cmd === "collect") {
  const sub = await resolveUser(need("user"));
  const dryRun = args.get("dry-run") === "true";
  const assume = args.get("assume-cutoff");
  if (assume && !dryRun) fail("--assume-cutoff is only allowed with --dry-run");
  if (assume && Number.isNaN(new Date(assume).getTime())) fail("--assume-cutoff must be an ISO date");
  const before = dryRun ? (await reportRows(sub)).length : 0;
  const s = await collectShadow(sub, { limit: Number(args.get("limit") ?? 150), dryRun, assumeCutoff: assume ? new Date(assume) : undefined });
  console.log(`mailbox ${label(sub)}: ${JSON.stringify(s)}`);
  if (dryRun) console.log(`DRY RUN: nothing was written (shadow rows before ${before}, after ${(await reportRows(sub)).length}).`);
  process.exit(0);
}

// Prospective-evaluation tooling lives in scripts/prospective.ts (status, label-set, analyze, synthetic-run, power, freeze-check).
if (["status", "label-set", "analyze", "synthetic-run", "power", "freeze-check"].includes(cmd ?? "")) {
  const mod = await import("./prospective.ts");
  await mod.run(cmd!, args, { resolveUser, label });
  process.exit(0);
}

if (cmd === "export") {
  const sub = await resolveUser(need("user"));
  const out = need("out");
  if (out.startsWith(process.cwd())) fail("--out must be outside the repository");
  const selfNames = (process.env.READER_SELF_NAMES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (selfNames.length === 0) fail("set READER_SELF_NAMES in .env.local (name tokens to redact)");
  const pending = await pendingModelReads(sub, Number(args.get("max") ?? 300));
  const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub)) ?? fail("no connection"));
  const { emails, missing } = await fetchEmailsById(token, pending.map((p) => p.gmailMessageId));
  const inputs = emails.map((e) => buildShadowInput(e, shadowKey(sub, e.id), 1, selfNames));
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const per = Number(args.get("batch") ?? 56);
  for (let b = 0; b * per < inputs.length; b += 1) writePrivateFile(join(out, `batch-${b}.jsonl`), inputs.slice(b * per, (b + 1) * per).map((i) => JSON.stringify(i)).join("\n") + "\n");
  writePrivateFile(join(out, "map.json"), JSON.stringify({ user: sub, keys: Object.fromEntries(emails.map((e) => [shadowKey(sub, e.id), e.id])) }));
  writePrivateFile(join(out, "guide.md"), `${GUIDE_V3}\n## Output format\n${OUTPUT_SPEC}\n`);
  console.log(`exported ${inputs.length} messages in ${Math.ceil(inputs.length / per)} batches (${READER_VERSION_V3}); ${missing.length} no longer fetchable. Delete ${out} after import.`);
  process.exit(0);
}

if (cmd === "import") {
  const dir = need("dir");
  const map: { user: string; keys: Record<string, string> } = JSON.parse(readFileSync(join(dir, "map.json"), "utf8"));
  const inputs = new Map<string, ReaderInput>();
  for (const f of readdirSync(dir).filter((x) => /^batch-\d+\.jsonl$/.test(x))) for (const l of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) { const i = JSON.parse(l) as ReaderInput; inputs.set(i.key, i); }
  const stat = { lines: 0, ok: 0, invalid: 0, unsupportedYes: 0, unknown: 0, notJson: 0, missingRow: 0, alreadyRead: 0 };
  const rejections: Record<string, number> = {};
  const seen = new Set<string>();
  const now = new Date();
  for (const f of readdirSync(dir).filter((x) => /^out-\d+\.jsonl$/.test(x))) for (const l of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
    stat.lines += 1;
    let raw: unknown;
    try { raw = JSON.parse(l); } catch { stat.notJson += 1; continue; }
    const key = (raw as { key?: string })?.key ?? "";
    const input = inputs.get(key), msgId = map.keys[key];
    if (!input || !msgId) { stat.unknown += 1; continue; }
    const rec = await getShadowRecord(map.user, msgId);
    if (!rec) { stat.missingRow += 1; continue; }
    const v = verifyOutput(raw, input);
    seen.add(key);
    if (v.status === "ok") stat.ok += 1; else if (v.status === "invalid") stat.invalid += 1; else stat.unsupportedYes += 1;
    for (const x of v.rejections) rejections[x] = (rejections[x] ?? 0) + 1;
    if (!(await saveResolution(resolveRecord(rec, v, now, auditGrounding(v, input).length)))) stat.alreadyRead += 1; // first read wins; never overwritten
  }
  console.log(`import: ${JSON.stringify(stat)} · expected ${Object.keys(map.keys).length}, no output ${Object.keys(map.keys).filter((k) => !seen.has(k)).length}`);
  console.log(`verification rejections: ${JSON.stringify(rejections)}`);
  if (args.get("delete") === "true") { rmSync(dir, { recursive: true, force: true }); console.log("temporary model inputs deleted"); }
  process.exit(0);
}

if (cmd === "report") {
  const only = args.get("user") ? await resolveUser(args.get("user")!) : null;
  const rows = await reportRows(only);
  const subs = [...new Set(rows.map((r) => r.userGoogleSub))];
  for (const sub of subs) {
    const mine = rows.filter((r) => r.userGoogleSub === sub);
    console.log(`\n== mailbox ${label(sub)} · ${READER_VERSION_V3}`);
    console.log(formatSummary(summarize(mine)));
  }
  if (subs.length === 0) console.log("no shadow rows yet");
  process.exit(0);
}

if (cmd === "review") {
  const sub = await resolveUser(need("user"));
  const items = await reviewItems(sub, false);
  const by: Record<string, number> = {};
  for (const i of items) by[`${i.reason}${i.actionable ? "" : " (waiting on a model read)"}`] = (by[`${i.reason}${i.actionable ? "" : " (waiting on a model read)"}`] ?? 0) + 1;
  console.log(`mailbox ${label(sub)}: ${items.length} review items ${JSON.stringify(by)}; actionable ${items.filter((i) => i.actionable).length}`);
  process.exit(0);
}

console.error("usage: collect | export | import | report | review");
process.exit(1);
