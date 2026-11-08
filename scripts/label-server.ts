// Local labeling tool: npm run eval:label -- --dataset <name> [--labeler <tag>] [--port 4747] [--only <ids file>]
// --only opens REVIEW mode: just those messages, in id order, starting at the first (not the first unlabeled). Saving writes a
// newer label row that supersedes the old one; nothing is changed unless you press save.
// Deliberately isolated: it never imports the extractor, predictions or evaluator, and reads only the local snapshot
// and the `labels` table, so a labeler cannot see (and cannot be anchored by) what the system predicted.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { evalDatasetItems, evalDatasets, labels as labelsTable } from "../lib/db/schema.ts";
import { formToLabels, renderPage, esc } from "../lib/eval-store/label-page.ts";
import { readSnapshot } from "../lib/eval-store/snapshot.ts";
import { resolveLabels, type LabelRow } from "../lib/eval-store/resolve-labels.ts";
import { DATASET_KINDS, SOURCE_FOR_DATASET, type DatasetKind } from "../lib/recruiting/ground-truth.ts";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) args.set(argv[i].slice(2), argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
const datasetName = args.get("dataset") ?? (console.error("error: missing --dataset"), process.exit(1));
const labeler = (args.get("labeler") ?? "me").slice(0, 40);
const port = Number(args.get("port") ?? 4747);
if (labeler.includes("@")) { console.error("error: --labeler must be an opaque tag, not an address"); process.exit(1); }

const db = getDb();
const [row] = await db.select().from(evalDatasets).where(eq(evalDatasets.name, datasetName)).limit(1);
if (!row) { console.error(`error: dataset "${datasetName}" is not registered`); process.exit(1); }
const kind = row.kind as DatasetKind;
if (!(DATASET_KINDS as readonly string[]).includes(kind)) process.exit(1);
const { manifest, members, context } = readSnapshot(datasetName);
const items = await db.select({ id: evalDatasetItems.gmailMessageId }).from(evalDatasetItems).where(eq(evalDatasetItems.datasetId, row.id));
const memberSet = new Set(items.map((i) => i.id));
// Stable, content-independent order: by id hash-free sort, so no one's picks depend on how a message "looks".
const onlyFile = args.get("only");
const only = onlyFile ? new Set(readFileSync(onlyFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)) : null;
if (only) for (const id of only) if (!memberSet.has(id)) { console.error("error: --only lists a message that is not a member of this dataset"); process.exit(1); }
const ordered = members.filter((m) => memberSet.has(m.id) && (!only || only.has(m.id))).sort((a, b) => (a.id < b.id ? -1 : 1));
const review = only !== null;
const token = randomBytes(18).toString("hex");

async function myLabels() {
  const rows = await db.select().from(labelsTable).where(eq(labelsTable.datasetId, row.id)).orderBy(asc(labelsTable.createdAt));
  const mine: LabelRow[] = rows
    .filter((r) => r.labeler === labeler && r.source === SOURCE_FOR_DATASET[kind])
    .map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field as never, value: r.value, source: r.source as never, createdAt: r.createdAt }));
  return resolveLabels(mine, [SOURCE_FOR_DATASET[kind]]);
}

const html = (res: import("node:http").ServerResponse, status: number, body: string) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  res.end(body);
};
const redirect = (res: import("node:http").ServerResponse, to: string) => { res.writeHead(303, { location: to, "cache-control": "no-store" }); res.end(); };

async function nextUnlabeled(from = 0) {
  const mine = await myLabels();
  for (let k = 0; k < ordered.length; k += 1) {
    const i = (from + k) % ordered.length;
    if (mine.get(ordered[i].id)?.is_recruiting === undefined) return { index: i, labeled: [...mine.values()].filter((v) => v.is_recruiting !== undefined).length };
  }
  return { index: -1, labeled: ordered.length };
}

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 100_000) throw new Error("too large"); chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return html(res, 403, "forbidden");
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.searchParams.get("t") !== token) return html(res, 403, "forbidden");
    const match = /^\/m\/(\d+)$/.exec(url.pathname);
    if (url.pathname === "/done") return html(res, 200, `<p style="font:16px system-ui;padding:32px">Review finished: all ${ordered.length} messages shown. Close this tab.</p>`);

    if (!match) {
      if (review) return redirect(res, `/m/0?t=${token}`);
      const { index } = await nextUnlabeled();
      return index < 0 ? html(res, 200, `<p style="font:16px system-ui;padding:32px">All ${ordered.length} messages in ${esc(datasetName)} are labeled. You can close this tab.</p>`) : redirect(res, `/m/${index}?t=${token}`);
    }
    const index = Number(match[1]);
    const message = ordered[index];
    if (!message) return html(res, 404, "not found");
    const mine = await myLabels();
    const refs = [...new Set([...mine.values()].map((v) => v.opportunity_ref).filter((v): v is string => typeof v === "string"))].sort();
    const threadItems = [...members, ...context].filter((m) => m.threadId === message.threadId && m.id !== message.id).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const page = (error?: string, existing = mine.get(message.id) ?? {}) =>
      renderPage({ token, index, total: ordered.length, labeled: [...mine.values()].filter((v) => v.is_recruiting !== undefined).length, dataset: datasetName, kind, asOf: manifest.asOf, message, thread: threadItems, existing, refs, error });

    if (req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const result = formToLabels(form, { kind, messageId: message.id, labeler });
      const afterReview = () => redirect(res, index + 1 < ordered.length ? `/m/${index + 1}?t=${token}` : `/done?t=${token}`);
      if (review && url.pathname.startsWith("/m/") && "skip" in result) return afterReview();
      if ("skip" in result) { const n = await nextUnlabeled(index + 1); return redirect(res, n.index < 0 ? `/?t=${token}` : `/m/${n.index}?t=${token}`); }
      if ("error" in result) return html(res, 422, page(result.error));
      // In review, pressing save on a label you agree with must not write anything: only genuine changes supersede.
      const before = mine.get(message.id) ?? {};
      const changed = review ? result.rows.filter((r) => JSON.stringify((before as Record<string, unknown>)[r.field]) !== JSON.stringify(r.value)) : result.rows;
      if (changed.length > 0) await db.insert(labelsTable).values(changed.map((r) => ({ datasetId: row.id, gmailMessageId: r.gmailMessageId, field: r.field, value: r.value as never, source: r.source, labeler: r.labeler })));
      if (review) return afterReview();
      const n = await nextUnlabeled(index + 1);
      return redirect(res, n.index < 0 ? `/?t=${token}` : `/m/${n.index}?t=${token}`);
    }
    return html(res, 200, page());
  } catch (error) {
    console.error(`label server error: ${error instanceof Error ? error.name : "unknown"}`); // never content
    html(res, 500, "error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`${review ? "REVIEW mode: " : ""}Labeling ${datasetName} (${kind}) as "${labeler}", ${ordered.length} messages. Predictions are not loaded in this process.`);
  console.log(`Open: http://127.0.0.1:${port}/?t=${token}`);
  console.log("Press Ctrl+C when done. Labels are saved as you go (append-only).");
});
