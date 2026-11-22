/**
 * Autonomy scorecard: product-level invariants and user burden measured on the LIVE workspace, with no labels needed (the labels-based measures are scripts/validation-metrics.ts and scripts/corpus-metrics.ts).
 * Read-only; prints counts and ids only, never text.   node ... scripts/autonomy-scorecard.ts <googleSub> [--details] [--json out.json]
 *
 * Invariants (each should be 0): an application with an explicit ending stays open; a closed application is reopened by a stage event; an application is both accepted and withdrawn; a message class
 * (event, survey, notice, community, admin, logistics) advances a job stage; a Gmail message is asked about twice.
 */
import { writeFileSync } from "node:fs";
import { disposeOutside } from "../lib/recruiting/disposition.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { reviewOptions } from "../lib/recruiting/product-config.ts";
import { attentionCount, autoResolved, buildReviewQueue } from "../lib/recruiting/review.ts";
const sub = process.argv[2]; const details = process.argv.includes("--details");
const ws = await loadWorkspace(sub, new Date());
const STAGE = new Set(["applied", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"]);
const CLASSED = /^class:(?:event|survey|notice|community|admin|logistics|marketing)$/;
const open = ws.opportunities.filter((o) => o.status === "active" && o.kind === "job");
const list = (label: string, ids: string[]) => { console.log(`${label}: ${ids.length}`); if (details) for (const i of ids.slice(0, 40)) console.log(`   ${i}`); };
const id8 = (e: { gmailMessageId: string }) => e.gmailMessageId.slice(0, 8);

const endedButOpen = open.filter((o) => o.events.some((e) => !e.outbound && !e.corrected && !e.confirmed && (e.signals.includes("ending:own") || e.signals.includes("withdrawal:ack")) && (e.type === "rejection" || e.type === "withdrawn"))).map((o) => `${o.company} | ${o.role ?? "-"}`);
const proposedOpen = open.filter((o) => o.proposedEnding).map((o) => `${o.company} | ${o.role ?? "-"} (${o.proposedEnding!.outcome})`);
const reopened = ws.opportunities.filter((o) => o.status === "closed" && o.contradictions?.some((c) => c.kind === "reopened")).map((o) => `${o.company} | ${o.role ?? "-"}`);
const acceptedAndWithdrawn = ws.opportunities.filter((o) => o.events.some((e) => e.type === "withdrawn") && o.outcome === "accepted").map((o) => `${o.company} | ${o.role ?? "-"}`);
const classAdvances = ws.opportunities.flatMap((o) => o.events.filter((e) => !e.outbound && !e.corrected && !e.confirmed && STAGE.has(e.type) && e.signals.some((s) => CLASSED.test(s))).map((e) => `${o.company} ${id8(e)} ${e.type}`));
const queue = buildReviewQueue(ws.opportunities, undefined, ws.possible, new Date(), reviewOptions());
const perMsg = new Map<string, number>(); for (const q of queue) perMsg.set(q.event.gmailMessageId, (perMsg.get(q.event.gmailMessageId) ?? 0) + 1);
const dupRows = [...perMsg.values()].reduce((a, c) => a + (c - 1), 0);
const important = queue.filter((q) => !q.weak && q.tier === "important"), house = queue.filter((q) => !q.weak && q.tier !== "important"), weak = queue.filter((q) => q.weak);
const subjects = new Map<string, number>(); for (const q of weak) { const k = (q.event.subject ?? "").toLowerCase().replace(/\d+/g, "#"); subjects.set(k, (subjects.get(k) ?? 0) + 1); }
const repeated = [...subjects.values()].filter((c) => c > 1).reduce((a, c) => a + c - 1, 0);
const classedAsked = queue.filter((q) => q.event.signals.some((s) => /^class:/.test(s))).length;
const suppressedByClass = ws.possible.filter((e) => e.signals.some((s) => /^class:/.test(s))).length;

console.log(`opportunities ${ws.opportunities.length} (${open.length} open jobs), events ${ws.opportunities.reduce((a, o) => a + o.events.length, 0)}, possible (outside the pipeline) ${ws.possible.length}, Today actions ${ws.actions.length}`);
console.log(`--- Review burden`);
console.log(`rows built ${queue.length} for ${perMsg.size} unique Gmail messages (duplicate rows ${dupRows}); shown as needs-you ${attentionCount(queue)} (important ${important.length}), housekeeping ${house.length}, weak suggestions ${weak.length}`);
console.log(`weak suggestions that repeat an earlier subject: ${repeated}; asked although a message class explains them: ${classedAsked}; resolved by class and not asked: ${suppressedByClass}`);
const resolvedBy = new Map<string, number>(); for (const r of autoResolved(ws.opportunities)) resolvedBy.set(r.resolution.resolver, (resolvedBy.get(r.resolution.resolver) ?? 0) + 1);
console.log(`investigator: resolved with stated evidence (listed on the Review screen, not hidden): ${[...resolvedBy.values()].reduce((a, c) => a + c, 0)} ${JSON.stringify(Object.fromEntries(resolvedBy))}`);
const disp = new Map<string, number>(); const violations: string[] = []; for (const e of ws.possible.filter((x) => !x.outbound)) { const d = disposeOutside(e); disp.set(d.kind, (disp.get(d.kind) ?? 0) + 1); if (d.kind === "violation") violations.push(`${e.gmailMessageId.slice(0, 8)} ${e.company ?? ""} | ${d.why}`); }
console.log(`--- Disposition of messages outside any journey: ${JSON.stringify(Object.fromEntries(disp))} (journeys hold ${ws.opportunities.reduce((a, o) => a + o.events.filter((x) => !x.outbound).length, 0)} inbound messages; violations = a message whose own facts put it in a journey but waits outside one, target 0)`);
if (details) for (const v of violations.slice(0, 30)) console.log(`   ${v}`);
console.log(`--- Invariants (target 0)`);
list("explicit ending text but the application is still open", endedButOpen);
list("open applications resting on an unsettled (proposed) ending", proposedOpen);
list("closed applications with a stage event after the ending (flagged reopened)", reopened);
list("accepted AND withdrawn", acceptedAndWithdrawn);
list("event/survey/notice/community/admin/logistics messages advancing a job stage", classAdvances);
if (process.argv.includes("--json")) { const out = process.argv[process.argv.indexOf("--json") + 1]; writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), opportunities: ws.opportunities.length, rows: queue.length, unique: perMsg.size, dupRows, needsYou: attentionCount(queue), housekeeping: house.length, weak: weak.length, repeated, endedButOpen: endedButOpen.length, proposedOpen: proposedOpen.length, reopened: reopened.length, acceptedAndWithdrawn: acceptedAndWithdrawn.length, classAdvances: classAdvances.length })); }
process.exit(0);
