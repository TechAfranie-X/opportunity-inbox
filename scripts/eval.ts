// Evaluation CLI. Run via the npm scripts (they load .env.local and the module hook):
//   npm run eval -- <command> [options]
// Commands: status | snapshot-random | snapshot-challenge | freeze | export-tasks | import-labels | export-labels | run | migrate-legacy-corrections | purge
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { evalDatasetItems, evalDatasets, evalRuns, gmailConnections, labels as labelsTable, recruitingEvents } from "../lib/db/schema.ts";
import { fetchEmailsById, fetchThreadMessages, listMessageIds } from "../lib/gmail/recruiting-source.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { evalDir, listDatasets, modeOf, purgeLocal, writePrivateFile } from "../lib/eval-store/private-fs.ts";
import { freezeLocal, manifestHash, readSnapshot, sampleIds, verifyFrozen, writeSnapshot, type Manifest } from "../lib/eval-store/snapshot.ts";
import { parseLabelsJsonl, toJsonl } from "../lib/eval-store/labels-io.ts";
import { draftsFromLegacyCorrection, parseCorrection } from "../lib/recruiting/corrections.ts";
import { evaluate, formatReport, type LabelRow } from "../lib/recruiting/evaluator.ts";
import { extractAll } from "../lib/recruiting/extract.ts";
import { DATASET_KINDS, HEADLINE_SOURCES, type DatasetKind } from "../lib/recruiting/ground-truth.ts";
import { DEFAULT_POLICY } from "../lib/recruiting/policy.ts";
import { resolveBatch } from "../lib/recruiting/entity/resolve.ts";
import { applyResolutions, formatShadowComparison } from "../lib/recruiting/entity/shadow.ts";
import { buildPredictions } from "../lib/recruiting/predictions.ts";
import { deriveProduct } from "../lib/recruiting/product.ts";
import { EXTRACTOR_VERSION } from "../lib/recruiting/version.ts";

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith("--")) {
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags.set(rest[i].slice(2), "true");
    else { flags.set(rest[i].slice(2), next); i += 1; }
  }
}
const flag = (k: string) => flags.get(k);
const need = (k: string) => { const v = flag(k); if (!v) fail(`missing --${k}`); return v as string; };
function fail(message: string): never { console.error(`error: ${message}`); process.exit(1); }
const kindOf = (v: string): DatasetKind => (DATASET_KINDS as readonly string[]).includes(v) ? (v as DatasetKind) : fail(`--kind must be one of ${DATASET_KINDS.join(", ")}`);

/** Floating "now" (UTC fields = wall clock), matching how the product treats today. */
const floating = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));

async function accessTokenFor(): Promise<string> {
  const db = getDb();
  const subs = (await db.select({ sub: gmailConnections.userGoogleSub }).from(gmailConnections)).map((r) => r.sub);
  const sub = flag("user") ?? (subs.length === 1 ? subs[0] : fail(`${subs.length} Gmail connections found; choose one with --user <sub>`));
  const refresh = await getGmailRefreshToken(sub);
  if (!refresh) fail("that account has no stored Gmail connection");
  return refreshGmailAccessToken(refresh);
}

async function datasetRow(name: string) {
  const [row] = await getDb().select().from(evalDatasets).where(eq(evalDatasets.name, name)).limit(1);
  return row;
}

async function createDataset(manifest: Manifest, threadOf: Map<string, string>) {
  const db = getDb();
  const [row] = await db.insert(evalDatasets).values({ name: manifest.name, kind: manifest.kind, note: `account=${manifest.account}` }).returning();
  const items = manifest.memberIds.map((id) => ({ datasetId: row.id, gmailMessageId: id, gmailThreadId: threadOf.get(id) ?? "" }));
  for (let i = 0; i < items.length; i += 500) await db.insert(evalDatasetItems).values(items.slice(i, i + 500));
}

async function main() {
  switch (command) {
    case "status": {
      console.log(`eval store: ${evalDir()}${existsSync(evalDir()) ? ` (mode ${modeOf(evalDir()).toString(8)})` : " (does not exist yet)"}`);
      const db = getDb();
      for (const name of listDatasets()) {
        const m = readSnapshot(name).manifest;
        const row = await datasetRow(name);
        console.log(`  ${name.padEnd(22)} ${m.kind.padEnd(14)} members ${String(m.memberIds.length).padStart(4)}  context ${String(m.contextIds.length).padStart(4)}  ${m.frozenAt ? `FROZEN ${m.frozenAt.slice(0, 10)}` : "not frozen"}  ${row ? "registered" : "NOT in database"}`);
      }
      const runs = await db.select().from(evalRuns);
      console.log(`runs recorded: ${runs.length} (official: ${runs.filter((r) => r.official).length})`);
      break;
    }

    case "snapshot-random": {
      // Honest development sample: uniform over the WHOLE mailbox window, not just recruiting-looking mail,
      // so recruiting recall is measurable. Frozen on creation. There is no way to replace a failed message.
      const name = need("name");
      const kind = kindOf(flag("kind") ?? "dev_random");
      if (kind === "dev_challenge") fail("random sampling is for dev_random or blind; use snapshot-challenge for curated sets");
      if (kind === "blind" && (!flag("user") || flag("confirm-blind-mailbox") !== "true")) {
        fail("a BLIND snapshot must name its mailbox explicitly: --user <sub> --confirm-blind-mailbox (it must not be the development mailbox)");
      }
      const n = Number(flag("n") ?? 200);
      if (!Number.isInteger(n) || n < 20) fail("--n must be an integer >= 20");
      if (await datasetRow(name)) fail(`dataset "${name}" already exists`);
      const token = await accessTokenFor();
      const query = "newer_than:365d -in:spam -in:trash -in:drafts -in:sent";
      const universe = await listMessageIds(token, 20000, query);
      const seed = flag("seed") ?? `${name}:${new Date().toISOString()}`;
      const picked = sampleIds(universe, n, seed);
      const { emails, missing } = await fetchEmailsById(token, picked);
      const members = emails.filter((e) => !e.outbound);
      const have = new Set(emails.map((e) => e.id));
      const context = (await fetchThreadMessages(token, members.map((m) => m.threadId))).filter((e) => !picked.includes(e.id));
      const manifest: Manifest = {
        name, kind, createdAt: new Date().toISOString(), frozenAt: null, manifestHash: null,
        asOf: floating(new Date()).toISOString(), account: flag("account") ?? (kind === "blind" ? "blind-1" : "dev-mailbox"),
        memberIds: picked, contextIds: [...new Set(context.map((c) => c.id))], missing: picked.filter((id) => !have.has(id)).concat(missing),
        sampling: { method: "random", seed, universeSize: universe.length, universeQuery: query, universeHash: manifestHash(universe) },
      };
      writeSnapshot(manifest, members, context);
      await createDataset(manifest, new Map(emails.map((e) => [e.id, e.threadId])));
      const frozen = freezeLocal(name);
      const db = getDb();
      const row = await datasetRow(name);
      await db.update(evalDatasets).set({ frozenAt: new Date(frozen.frozenAt!), manifestHash: frozen.manifestHash }).where(eq(evalDatasets.id, row.id));
      console.log(`${name}: ${picked.length} sampled from ${universe.length} messages, ${members.length} fetched, ${manifest.missing.length} unfetchable (kept, not replaced), ${manifest.contextIds.length} thread-context messages. FROZEN ${frozen.manifestHash!.slice(0, 12)}.`);
      console.log("Next: npm run eval -- export-tasks --dataset " + name + " --out <file>   (contains email content: keep it out of the repo)");
      break;
    }

    case "snapshot-challenge": {
      // Curated hard/regression cases: chosen on purpose, may be inspected and optimised against, never an unbiased estimate.
      const name = need("name");
      const ids = (flag("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) fail("pass message ids with --ids a,b,c");
      if (await datasetRow(name)) fail(`dataset "${name}" already exists`);
      const token = await accessTokenFor();
      const { emails, missing } = await fetchEmailsById(token, ids);
      const context = (await fetchThreadMessages(token, emails.map((m) => m.threadId))).filter((e) => !ids.includes(e.id));
      const manifest: Manifest = {
        name, kind: "dev_challenge", createdAt: new Date().toISOString(), frozenAt: null, manifestHash: null,
        asOf: floating(new Date()).toISOString(), account: flag("account") ?? "dev-mailbox",
        memberIds: ids, contextIds: [...new Set(context.map((c) => c.id))], missing,
        sampling: { method: "curated", seed: null, universeSize: null, universeQuery: null, universeHash: null },
      };
      writeSnapshot(manifest, emails.filter((e) => !e.outbound), context);
      await createDataset(manifest, new Map(emails.map((e) => [e.id, e.threadId])));
      console.log(`${name}: ${ids.length} curated, ${missing.length} unfetchable. Not frozen (a challenge set may grow); freeze it with: npm run eval -- freeze --name ${name}`);
      break;
    }

    case "freeze": {
      const name = need("name");
      const frozen = freezeLocal(name);
      const row = await datasetRow(name);
      if (!row) fail("dataset is not registered in the database");
      await getDb().update(evalDatasets).set({ frozenAt: new Date(frozen.frozenAt!), manifestHash: frozen.manifestHash }).where(eq(evalDatasets.id, row.id));
      console.log(`${name} frozen: ${frozen.memberIds.length} members, hash ${frozen.manifestHash}`);
      break;
    }

    case "export-tasks": {
      // What a reviewer needs to label: the messages. Deliberately NO predictions of any kind.
      const name = need("dataset");
      const out = need("out");
      const { manifest, members, context } = readSnapshot(name);
      const byThread = new Map<string, number>();
      for (const m of [...members, ...context]) byThread.set(m.threadId, (byThread.get(m.threadId) ?? 0) + 1);
      const lines = members.map((m) => JSON.stringify({
        gmailMessageId: m.id, threadId: m.threadId, threadSize: byThread.get(m.threadId) ?? 1,
        from: m.from, subject: m.subject, receivedAt: m.receivedAt.toISOString(), bodyText: m.bodyText,
      }));
      writePrivateFile(out, lines.join("\n") + "\n");
      console.log(`wrote ${lines.length} tasks of "${manifest.name}" to ${out} (mode 600). It contains email content: do not commit or share it beyond your reviewer.`);
      break;
    }

    case "import-labels": {
      const name = need("dataset");
      const file = need("file");
      const row = await datasetRow(name) ?? fail(`dataset "${name}" is not registered`);
      const kind = kindOf(row.kind);
      const items = await getDb().select({ id: evalDatasetItems.gmailMessageId }).from(evalDatasetItems).where(eq(evalDatasetItems.datasetId, row.id));
      const { rows, errors } = parseLabelsJsonl(readFileSync(file, "utf8"), { kind, memberIds: new Set(items.map((i) => i.id)), defaultLabeler: flag("labeler") ?? "me", source: flag("source") as never });
      if (errors.length > 0) { console.error(errors.slice(0, 25).join("\n")); fail(`${errors.length} invalid line(s); nothing imported`); }
      const db = getDb();
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const res = await db.insert(labelsTable).values(rows.slice(i, i + 500).map((r) => ({ datasetId: row.id, gmailMessageId: r.gmailMessageId, field: r.field, value: r.value as never, source: r.source, labeler: r.labeler }))).returning({ id: labelsTable.id });
        inserted += res.length;
      }
      console.log(`imported ${inserted} label row(s) into ${name} (append-only; no predictions were involved)`);
      break;
    }

    case "export-labels": {
      const name = need("dataset");
      const row = await datasetRow(name) ?? fail(`dataset "${name}" is not registered`);
      const rows = await getDb().select().from(labelsTable).where(eq(labelsTable.datasetId, row.id)).orderBy(asc(labelsTable.createdAt));
      const text = toJsonl(rows.map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field, value: r.value, labeler: r.labeler, source: r.source, createdAt: r.createdAt })));
      if (flag("out")) writePrivateFile(flag("out")!, text); else process.stdout.write(text);
      console.error(`exported ${rows.length} label row(s) (no content, no predictions)`);
      break;
    }

    case "run": {
      const name = need("dataset");
      const row = await datasetRow(name) ?? fail(`dataset "${name}" is not registered`);
      const kind = kindOf(row.kind);
      if (flag("shadow") === "true" && kind === "blind") fail("--shadow is not allowed on BLIND: it would be a second evaluation of the blind set. Evaluate candidate changes on DEV, then freeze the extractor.");
      if (kind !== "dev_challenge") verifyFrozen(name); // DEV-RANDOM and BLIND are only ever scored once frozen and intact
      const { manifest, members, context } = readSnapshot(name);
      const db = getDb();
      let official = false;
      if (kind === "blind") {
        if (flag("confirm-blind") !== "true") fail("BLIND evaluation needs --confirm-blind. The first run is the official result; every later run is recorded as contaminated.");
        const humanLabels = await db.select({ id: labelsTable.id }).from(labelsTable).where(eq(labelsTable.datasetId, row.id)).limit(1);
        if (humanLabels.length === 0) fail("no labels exist for this BLIND dataset yet. Labels must be created, with predictions hidden, BEFORE the first extractor run.");
        const prior = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.datasetId, row.id)).limit(1);
        official = prior.length === 0;
      }
      const items = await db.select().from(evalDatasetItems).where(eq(evalDatasetItems.datasetId, row.id));
      const threadOf = new Map(items.map((i) => [i.gmailMessageId, i.gmailThreadId]));
      const sources = kind === "dev_challenge" ? undefined : HEADLINE_SOURCES;
      const labelRows = await db.select().from(labelsTable).where(eq(labelsTable.datasetId, row.id));
      const all = [...members, ...context];
      const predictions = buildPredictions(all);
      const events = extractAll(all);
      const asOf = new Date(manifest.asOf);
      const product = deriveProduct(events, asOf);
      const report = evaluate({
        kind, datasetName: name, official: kind === "blind" ? official : undefined, asOf, messageIds: manifest.memberIds, threadOf,
        labels: labelRows.map((l): LabelRow => ({ gmailMessageId: l.gmailMessageId, field: l.field as never, value: l.value, source: l.source as never, createdAt: l.createdAt })),
        predictions: predictions.filter((p) => manifest.memberIds.includes(p.gmailMessageId)),
        predictedGroups: product.groups, predictedTodayThreads: product.todayThreads, sources, policy: DEFAULT_POLICY,
      });
      console.log(formatReport(report));
      if (flag("shadow") === "true") {
        // Company resolver in shadow mode: same labels, same predictions, only the company replaced. Never recorded.
        const inbound = all.filter((e) => !e.outbound);
        const known = [...new Set(events.map((e) => e.company).filter((c): c is string => !!c))];
        const resolutions = resolveBatch(inbound.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, replyTo: e.replyTo, subject: e.subject, body: e.bodyText })), undefined, known);
        const shadowPredictions = applyResolutions(predictions, resolutions).filter((p) => manifest.memberIds.includes(p.gmailMessageId));
        const shadowReport = evaluate({
          kind, datasetName: name, asOf, messageIds: manifest.memberIds, threadOf, labels: labelRows.map((l): LabelRow => ({ gmailMessageId: l.gmailMessageId, field: l.field as never, value: l.value, source: l.source as never, createdAt: l.createdAt })),
          predictions: shadowPredictions, predictedGroups: product.groups, predictedTodayThreads: product.todayThreads, sources, policy: DEFAULT_POLICY,
        });
        console.log("\n" + formatShadowComparison(report, shadowReport));
        console.log("(shadow results are not recorded)");
        return;
      }
      let commit: string | null = null;
      try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
      if (flag("no-record") !== "true") {
        await db.insert(evalRuns).values({
          datasetId: row.id, extractorVersion: EXTRACTOR_VERSION, gitCommit: commit, policy: { ...DEFAULT_POLICY }, labelSources: report.labelSources,
          metrics: report as never, results: predictions.filter((p) => manifest.memberIds.includes(p.gmailMessageId)) as never, official, itemCount: manifest.memberIds.length,
        });
        console.log(`\nrun recorded (extractor ${EXTRACTOR_VERSION}${commit ? `, commit ${commit}` : ""}${kind === "blind" ? official ? ", OFFICIAL" : ", CONTAMINATED" : ""})`);
      }
      break;
    }

    case "migrate-legacy-corrections": {
      // Corrections made before label logging existed live in a mutable column. Their original prediction cannot be proven
      // (the extractor has been re-run since), so they become `legacy_reconstructed` labels: regression material and
      // DEV-CHALLENGE examples, never headline metrics. Idempotent: a message already migrated is skipped.
      const db = getDb();
      const rows = await db.select().from(recruitingEvents).where(isNotNull(recruitingEvents.correction));
      let migrated = 0, skipped = 0;
      for (const row of rows) {
        const correction = parseCorrection(row.correction);
        const drafts = correction ? draftsFromLegacyCorrection(correction) : [];
        if (drafts.length === 0) continue;
        const have = await db.select({ id: labelsTable.id }).from(labelsTable).where(and(eq(labelsTable.userGoogleSub, row.userGoogleSub), eq(labelsTable.gmailMessageId, row.gmailMessageId), eq(labelsTable.source, "legacy_reconstructed"))).limit(1);
        if (have.length > 0) { skipped += 1; continue; }
        await db.insert(labelsTable).values(drafts.map((d) => ({ userGoogleSub: row.userGoogleSub, gmailMessageId: row.gmailMessageId, field: d.field, value: d.value as never, source: "legacy_reconstructed" as const, labeler: "legacy", predictionId: null })));
        migrated += 1;
      }
      console.log(`legacy corrections: ${migrated} message(s) migrated, ${skipped} already done. Source: legacy_reconstructed (excluded from DEV-RANDOM and BLIND headline metrics).`);
      const into = flag("dataset");
      if (into) {
        // Optional: copy them into a DEV-CHALLENGE dataset as regression examples, for the messages that are members.
        const row = await datasetRow(into) ?? fail(`dataset "${into}" is not registered`);
        if (row.kind !== "dev_challenge") fail("legacy labels may only be copied into a dev_challenge dataset");
        const members = new Set((await db.select({ id: evalDatasetItems.gmailMessageId }).from(evalDatasetItems).where(eq(evalDatasetItems.datasetId, row.id))).map((i) => i.id));
        const legacy = (await db.select().from(labelsTable).where(eq(labelsTable.source, "legacy_reconstructed"))).filter((l) => l.datasetId === null && members.has(l.gmailMessageId));
        const already = new Set((await db.select().from(labelsTable).where(and(eq(labelsTable.datasetId, row.id), eq(labelsTable.source, "legacy_reconstructed")))).map((l) => `${l.gmailMessageId}|${l.field}`));
        const fresh = legacy.filter((l) => !already.has(`${l.gmailMessageId}|${l.field}`));
        if (fresh.length > 0) await db.insert(labelsTable).values(fresh.map((l) => ({ datasetId: row.id, gmailMessageId: l.gmailMessageId, field: l.field, value: l.value as never, source: "legacy_reconstructed" as const, labeler: "legacy" })));
        console.log(`copied ${fresh.length} legacy label row(s) into ${into}`);
      }
      break;
    }

    case "purge": {
      const dataset = flag("dataset");
      if (flag("yes") !== "true") {
        console.log(`This deletes ${dataset ? `the local snapshot of "${dataset}"` : `EVERY local snapshot under ${evalDir()}`} (raw message bodies). Labels and run logs in Postgres hold no content and are kept unless you add --include-db.`);
        console.log("Re-run with --yes to confirm.");
        process.exit(2);
      }
      const removed = purgeLocal(dataset);
      console.log(`removed ${removed} file(s) from the local eval store`);
      if (flag("include-db") === "true") {
        const db = getDb();
        const rows = dataset ? await db.select({ id: evalDatasets.id }).from(evalDatasets).where(eq(evalDatasets.name, dataset)) : await db.select({ id: evalDatasets.id }).from(evalDatasets);
        if (rows.length > 0) {
          await db.delete(evalDatasets).where(inArray(evalDatasets.id, rows.map((r) => r.id)));
          console.log(`removed ${rows.length} dataset record(s) with their labels and runs from Postgres`);
        }
      }
      break;
    }

    default:
      console.log("usage: npm run eval -- <status|snapshot-random|snapshot-challenge|freeze|export-tasks|import-labels|export-labels|run|purge> [options]");
      process.exit(command ? 1 : 0);
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : "unknown"}`);
  process.exit(1);
});

