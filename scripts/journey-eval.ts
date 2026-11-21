/**
 * "One email -> complete journey" evaluation. For each truth journey, take a seed message, hand ONLY that message to the investigator (lib/investigate/journey.ts) and measure what it reconstructs:
 *   application identity   the chosen application contains the truth journey (recall >= 0.6) with few foreign messages (precision >= 0.8)
 *   historical completeness recall / precision of the reconstructed timeline against the truth journey's messages
 *   lifecycle correctness   status (open/closed) and outcome (rejected / withdrawn / offer or accepted) against the truth
 *   grounded next action    an active journey's next action cites evidence messages that belong to the journey
 *   user intervention       Review questions on the journey's messages + questions the investigation itself could not resolve
 * and compares the investigated result with the BASELINE: the opportunity the product had grouped the seed into.
 *   node ... scripts/journey-eval.ts <googleSub> [--truth file] [--gmail] [--seeds 2] [--details] [--independent]
 * The default truth is the frozen development validation set: DEVELOPMENT evidence only (its failures were inspected). Pass --independent only with truth labelled blind by someone else.
 * --gmail lets the investigator retrieve related messages from Gmail (read-only, bounded) when stored evidence leaves the journey ambiguous.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { reconstructJourney, type Journey } from "../lib/investigate/journey.ts";
import { retrieveRelated } from "../lib/investigate/retrieve.ts";
import { identityContext, reviewOptions } from "../lib/recruiting/product-config.ts";
import { buildReviewQueue } from "../lib/recruiting/review.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
const sub = process.argv[2]; const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const blind = process.argv.includes("--blind"); // the seed is taken OUT of its journey and given as a lone, unplaced message: can the investigator find its journey from the rest of the evidence?
const truthFile = arg("--truth", `${homedir()}/.opportunity-inbox-validation/validation-v1.json`), perJourney = Number(arg("--seeds", "2")), useGmail = process.argv.includes("--gmail"), details = process.argv.includes("--details");
type TJ = { id: string; label: string; status: string; outcome: string | null; messages: string[] };
const truth = JSON.parse(readFileSync(truthFile, "utf8")) as { journeys: TJ[] };
const ws = await loadWorkspace(sub, new Date());
const queue = buildReviewQueue(ws.opportunities, undefined, ws.possible, new Date(), reviewOptions());
const askedAbout = new Set(queue.map((q) => q.event.gmailMessageId.slice(0, 8)));
import type { Opportunity } from "../lib/recruiting/types.ts";
const unplace = (id: string): Opportunity[] => { const out: Opportunity[] = []; for (const o of ws.opportunities) { const e = o.events.find((x) => x.gmailMessageId.startsWith(id.slice(0, 8))); if (!e) { out.push(o); continue; } if (o.events.length > 1) out.push({ ...o, events: o.events.filter((x) => x !== e) }); out.push({ ...o, key: `${o.key}~unplaced`, events: [e], status: "active", stage: "applied", outcome: null, closedBy: null }); } return out; };
const known = new Set(ws.opportunities.flatMap((o) => o.events.map((e) => e.gmailMessageId)));
const token = useGmail ? await refreshGmailAccessToken((await getGmailRefreshToken(sub))!) : null;
const stateOk = (t: TJ, st: Journey["state"] | null) => { if (!st) return false; const open = st.status === "active"; if (t.status === "active" && !open) return false; if (t.status === "closed" && open) return false; if (t.outcome === "rejected") return st.closedBy === "rejected"; if (t.outcome === "withdrawn") return st.closedBy === "withdrawn"; if (t.outcome === "offer" || t.outcome === "accepted") return st.outcome === "offer" || st.outcome === "accepted"; return true; };
type Score = { n: number; identity: number; recall: number; precision: number; life: number; resolved: number; ambiguous: number };
const mkScore = (): Score => ({ n: 0, identity: 0, recall: 0, precision: 0, life: 0, resolved: 0, ambiguous: 0 });
const base = mkScore(), inv = mkScore(); let wrongPlace = 0, misplaced = 0, grounded = 0, ungrounded = 0, noAction = 0, qInv = 0, qReview = 0, gmailUsed = 0, gmailFound = 0;
const lines: string[] = [];
for (const t of truth.journeys) {
  const tset = new Set(t.messages.map((m) => m.slice(0, 8)));
  const seeds = (blind ? [...new Set([t.messages[t.messages.length - 1], t.messages[Math.floor(t.messages.length / 2)]])].filter((m) => t.messages.indexOf(m) > 0) : [...new Set([t.messages[0], t.messages[t.messages.length - 1], t.messages[Math.floor(t.messages.length / 2)]])]).slice(0, perJourney);
  if (blind && t.messages.length < 3) continue;
  for (const s of seeds) {
    const opps = blind ? unplace(s) : ws.opportunities;
    let j = reconstructJourney(s, { opportunities: opps, possible: ws.possible, actions: ws.actions, ctx: identityContext() });
    if (!j) continue;
    if (token && (j.decision !== "resolved" || blind)) { const seedEv = ws.opportunities.flatMap((o) => o.events).find((e) => e.gmailMessageId.startsWith(s.slice(0, 8))); if (seedEv) { gmailUsed++; const extra = await retrieveRelated(token, { gmailThreadId: seedEv.gmailThreadId, company: seedEv.company }, known); gmailFound += extra.length; if (extra.length) j = reconstructJourney(s, { opportunities: opps, possible: ws.possible, actions: ws.actions, ctx: identityContext(), extraEvents: extra }) ?? j; } }
    const home = opps.find((o) => o.events.some((e) => e.gmailMessageId.startsWith(s.slice(0, 8))));
    const score = (sc: Score, tl: string[], st: Journey["state"] | null, decided: boolean, supporting: Set<string> = new Set()) => {
      sc.n++; const core = tl.filter((x) => !supporting.has(x)); const hit = tl.filter((x) => tset.has(x)).length, rec = tset.size ? hit / tset.size : 0, pre = core.length ? core.filter((x) => tset.has(x)).length / core.length : 0; // supporting history counts toward completeness, never against precision
      sc.recall += rec; sc.precision += pre; if (decided && rec >= 0.6 && pre >= 0.8) sc.identity++; if (stateOk(t, st)) sc.life++; if (decided) sc.resolved++; else sc.ambiguous++;
      return { rec, pre };
    };
    const bTl = home ? home.events.filter((e) => !e.outbound).map((e) => e.gmailMessageId.slice(0, 8)) : [];
    const b = score(base, bTl, home ? { status: home.status, stage: home.stage, outcome: home.outcome ?? null, closedBy: home.closedBy ?? null } : null, !!home);
    const i = score(inv, j.timeline.map((x) => x.id8), j.state, j.decision === "resolved", new Set(j.timeline.filter((x) => x.supporting).map((x) => x.id8)));
    if (j.misplaced) misplaced++;
    if (blind && j.decision === "resolved" && i.rec < 0.6) wrongPlace++;
    if (j.state?.status === "active") { if (!j.nextAction) noAction++; else if (j.nextAction.evidence.length > 0) grounded++; else ungrounded++; }
    qInv += j.questions.length; qReview += j.timeline.filter((x) => askedAbout.has(x.id8)).length;
    if (details && (i.rec < 0.6 || i.pre < 0.8 || !stateOk(t, j.state) || j.decision !== "resolved")) lines.push(`${t.id.padEnd(8)} seed ${s.slice(0, 8)} base[rec ${b.rec.toFixed(2)} pre ${b.pre.toFixed(2)}] inv[rec ${i.rec.toFixed(2)} pre ${i.pre.toFixed(2)} ${j.decision}] state ${j.state ? `${j.state.status}/${j.state.closedBy ?? j.state.outcome ?? "-"}` : "none"} truth ${t.status}/${t.outcome ?? "-"}${j.misplaced ? " MISPLACED" : ""}${j.questions.length ? ` Q:${j.questions[0].slice(0, 60)}` : ""}`);
  }
}
const pct = (a: number, n: number) => (n ? `${((a / n) * 100).toFixed(1)}%` : "n/a"), mean = (a: number, n: number) => (n ? (a / n).toFixed(2) : "n/a");
console.log(`${process.argv.includes("--independent") ? "INDEPENDENT truth" : "DEVELOPMENT truth (the frozen set; failures were inspected: NOT evidence of accuracy)"}: ${base.n} seeds from ${truth.journeys.length} journeys${useGmail ? `; Gmail retrieval used on ${gmailUsed} ambiguous seeds, found ${gmailFound} extra messages` : ""}`);
console.log(`                         baseline (as grouped)   investigated (one email in)`);
console.log(`application identity     ${pct(base.identity, base.n).padEnd(22)}  ${pct(inv.identity, inv.n)}`);
console.log(`journey recall           ${mean(base.recall, base.n).padEnd(22)}  ${mean(inv.recall, inv.n)}`);
console.log(`journey precision        ${mean(base.precision, base.n).padEnd(22)}  ${mean(inv.precision, inv.n)}`);
console.log(`lifecycle (status+outcome) ${pct(base.life, base.n).padEnd(20)}  ${pct(inv.life, inv.n)}`);
console.log(`decided / left ambiguous ${`${base.resolved} / ${base.ambiguous}`.padEnd(22)}  ${inv.resolved} / ${inv.ambiguous}`);
console.log(`investigation moved the seed to a different application: ${misplaced}${blind ? `   (blind mode: decided but WRONG application: ${wrongPlace})` : ""}`);
console.log(`next action on open journeys: grounded ${grounded}, ungrounded ${ungrounded}, none ${noAction}`);
console.log(`user intervention: Review questions asked about journey messages ${qReview}; questions the investigation could not resolve ${qInv}`);
for (const l of lines) console.log(l);
process.exit(0);
