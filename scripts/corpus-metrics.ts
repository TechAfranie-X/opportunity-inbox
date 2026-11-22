/**
 * Scores the LIVE product (the stored events as the workspace shows them under the current environment switches) against the private real-mail corpus (~/.opportunity-inbox-corpus).
 * Uses ids and labels only. Reports application detection, false opportunities, offer and rejection correctness, and review burden. Labels with ownerConfirmed=false were made by Claude's
 * reading of the real messages and are provisional.   node ... scripts/corpus-metrics.ts <googleSub>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { reviewOptions } from "../lib/recruiting/product-config.ts";
import { attentionCount, buildReviewQueue } from "../lib/recruiting/review.ts";
const sub = process.argv[2];
type Row = { messageId: string; company: string; storedType: string; application: boolean | "unsure"; typeOk?: boolean | "unsure" };
const rows = readFileSync(`${homedir()}/.opportunity-inbox-corpus/corpus-${sub.slice(0, 6)}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row);
const ws = await loadWorkspace(sub, new Date());
const inPipe = new Map<string, { type: string; closed: boolean; proposed: boolean; closedBy: string | null | undefined; kind: string; programEvidence: boolean }>();
for (const o of ws.opportunities) for (const e of o.events) inPipe.set(e.gmailMessageId, { type: e.type, closed: o.status === "closed", proposed: !!o.proposedEnding, closedBy: o.closedBy, kind: o.kind ?? "job", programEvidence: e.signals.some((x) => x.startsWith("program:evidence:") || x === "class:program-acceptance" || x === "program:named") });
const yes = rows.filter((r) => r.application === true), no = rows.filter((r) => r.application === false);
const tp = yes.filter((r) => inPipe.has(r.messageId)).length, fp = no.filter((r) => inPipe.has(r.messageId)).length;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const realOffers = rows.filter((r) => r.storedType === "offer" && r.typeOk === true), falseOffers = rows.filter((r) => r.storedType === "offer" && r.typeOk === false);
const realRej = rows.filter((r) => r.storedType === "rejection" && r.typeOk === true), falseRej = rows.filter((r) => r.storedType === "rejection" && r.typeOk === false);
const asOffer = (r: Row) => inPipe.get(r.messageId)?.type === "offer";
const settled = (r: Row) => { const p = inPipe.get(r.messageId); return !!p && p.closed && (p.closedBy === "rejected" || p.closedBy === "withdrawn"); };
const queue = buildReviewQueue(ws.opportunities, undefined, ws.possible, new Date(), reviewOptions());
console.log(`switches: ENTRY_POLICY=${process.env.ENTRY_POLICY ?? "on"} IDENTITY_V3=${process.env.IDENTITY_V3 ?? "on"} REVIEW_PRIORITY=${process.env.REVIEW_PRIORITY ?? "on"}`);
console.log(`labelled application messages in the pipeline (recall): ${tp}/${yes.length} = ${pct(tp, yes.length)}`);
const fpRows = no.filter((r) => inPipe.has(r.messageId)); const fpProgram = fpRows.filter((r) => inPipe.get(r.messageId)!.programEvidence || inPipe.get(r.messageId)!.kind !== "job").length;
console.log(`labelled NON-application messages in the pipeline (false opportunities): ${fp}/${no.length}; precision of pipeline entries judged: ${pct(tp, tp + fp)}; of those ${fpProgram} are programme evidence / programme journeys (the provisional labels have no programme lane), ${fp - fpProgram} sit in job journeys`);
console.log(`real offers kept as offers: ${realOffers.filter(asOffer).length}/${realOffers.length}; FALSE offers shown as offers: ${falseOffers.filter(asOffer).length}/${falseOffers.length}`);
console.log(`real rejections settled: ${realRej.filter(settled).length}/${realRej.length}; FALSE rejections that close an application: ${falseRej.filter(settled).length}/${falseRej.length}`);
console.log(`active applications ${ws.opportunities.filter((o) => o.status === "active").length}; Review: needs-you ${attentionCount(queue)}, all items ${queue.filter((q) => !q.weak).length}, weak/possible ${ws.possible.length}`);
if (process.argv.includes("--details")) {
  const line = (r: Row) => `   ${r.company.slice(0, 28)} (${r.storedType})`;
  console.log("MISSED true applications:"); for (const r of yes.filter((x) => !inPipe.has(x.messageId))) console.log(line(r));
  console.log("FALSE opportunities still in the pipeline:"); for (const r of no.filter((x) => inPipe.has(x.messageId))) console.log(line(r));
  console.log("FALSE offers still shown as offers:"); for (const r of falseOffers.filter(asOffer)) console.log(line(r));
  console.log("FALSE rejections that close:"); for (const r of falseRej.filter(settled)) console.log(line(r));
  console.log("real rejections NOT settled:"); for (const r of realRej.filter((x) => !settled(x))) console.log(line(r), JSON.stringify(inPipe.get(r.messageId)));
}
process.exit(0);
