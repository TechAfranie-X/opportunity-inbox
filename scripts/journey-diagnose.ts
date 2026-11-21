/**
 * Failure-family diagnosis of the One Email -> Complete Journey evaluation (blind mode: the seed is taken out of its journey and given alone). For every seed it asks, in order:
 *   evidence      were the truth journey's other messages stored at all?
 *   fragmentation does ONE product application hold the journey, or did the product itself split it (the ceiling on what choosing one candidate can reach)?
 *   retrieval     were the application(s) holding the journey among the investigator's candidates?
 *   identity      did the investigator pick a candidate that holds the journey (resolved right / resolved wrong / ambiguous with the right one among the candidates / ambiguous without it)?
 *   semantics     did the seed's stored type match the truth's expected type?
 *   lifecycle     given the journey's own messages, does the final state (status/outcome) match the truth (and is the truth's state consistent with the evidence)?
 *   missing info  is a vendor, programme, requisition or cycle fact involved?
 * and prints the failure families with counts, so the largest PROVEN bottleneck is fixed first. DEVELOPMENT truth (frozen validation set); nothing here is accuracy evidence.
 *   node ... scripts/journey-diagnose.ts <googleSub> [--truth file] [--details]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { reconstructJourney } from "../lib/investigate/journey.ts";
import { identityContext } from "../lib/recruiting/product-config.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import type { Opportunity } from "../lib/recruiting/types.ts";
const sub = process.argv[2]; const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const truthFile = arg("--truth", `${homedir()}/.opportunity-inbox-validation/validation-v1.json`), details = process.argv.includes("--details");
type TJ = { id: string; status: string; outcome: string | null; messages: string[]; kind: string };
const truth = JSON.parse(readFileSync(truthFile, "utf8")) as { journeys: TJ[]; items: { id: string; journey: string | null; expect: string }[] };
const expectOf = new Map(truth.items.map((i) => [i.id.slice(0, 8), i.expect]));
const ws = await loadWorkspace(sub, new Date());
const all = ws.opportunities.flatMap((o) => o.events.map((e) => ({ e, o })));
const oppOf = new Map(all.map((x) => [x.e.gmailMessageId.slice(0, 8), x.o]));
const outside = new Set(ws.possible.map((e) => e.gmailMessageId.slice(0, 8))); // stored, but kept outside the pipeline by design (admin / not-a-receipt / weak)
const unplace = (id: string): Opportunity[] => { const out: Opportunity[] = []; for (const o of ws.opportunities) { const e = o.events.find((x) => x.gmailMessageId.startsWith(id.slice(0, 8))); if (!e) { out.push(o); continue; } if (o.events.length > 1) out.push({ ...o, events: o.events.filter((x) => x !== e) }); out.push({ ...o, key: `${o.key}~unplaced`, events: [e], status: "active", stage: "applied", outcome: null, closedBy: null }); } return out; };
const TYPE_OK: Record<string, string[]> = { applied: ["applied"], assessment: ["assessment", "assessment_completed"], interview: ["interview_invite", "interview_scheduled"], offer: ["offer"], rejection: ["rejection"], acceptance: ["offer", "status_update"], update: ["status_update", "follow_up"] };
const fam = new Map<string, string[]>(); const add = (f: string, line: string) => fam.set(f, [...(fam.get(f) ?? []), line]);
let n = 0, ok = 0; let retrSum = 0, retrN = 0;
const stateOk = (t: TJ, st: { status: string; closedBy: string | null; outcome: string | null } | null) => { if (!st) return false; const open = st.status === "active"; if (t.status === "active" && !open) return false; if (t.status === "closed" && open) return false; if (t.outcome === "rejected") return st.closedBy === "rejected"; if (t.outcome === "withdrawn") return st.closedBy === "withdrawn"; if (t.outcome === "offer" || t.outcome === "accepted") return st.outcome === "offer" || st.outcome === "accepted"; return true; };
for (const t of truth.journeys) {
  if (t.messages.length < 3) continue;
  const seeds = [...new Set([t.messages[t.messages.length - 1], t.messages[Math.floor(t.messages.length / 2)]])].filter((m) => t.messages.indexOf(m) > 0);
  for (const s of seeds) {
    n++; const sid = s.slice(0, 8), others = t.messages.filter((m) => m.slice(0, 8) !== sid).map((m) => m.slice(0, 8));
    const tag = `${t.id} ${sid}`;
    // evidence
    const stored = others.filter((m) => oppOf.has(m) || outside.has(m)); if (stored.length < others.length) { add("E  evidence not stored", `${tag}: ${others.length - stored.length} of ${others.length} journey messages are not stored`); continue; }
    // fragmentation: the best single product application's share of the journey (excluding the seed)
    const opps = unplace(s); const byOpp = new Map<string, number>();
    for (const m of others.filter((x) => oppOf.has(x))) { const o = opps.find((x) => x.events.some((e) => e.gmailMessageId.startsWith(m))); if (o) byOpp.set(o.key, (byOpp.get(o.key) ?? 0) + 1); }
    const inPipeline = others.filter((m) => oppOf.has(m)).length, bestHold = inPipeline ? Math.max(0, ...byOpp.values()) / inPipeline : 0;
    const j = reconstructJourney(s, { opportunities: opps, possible: ws.possible, actions: ws.actions, ctx: identityContext() });
    if (!j) { add("R  seed not found", tag); continue; }
    // retrieval: the investigator's candidate applications vs the applications holding the journey
    const holdKeys = [...byOpp.entries()].filter(([, c]) => c / others.length >= 0.3).map(([k]) => k);
    const candKeys = new Set(j.candidates.map((c) => c.key));
    const retrieved = holdKeys.length ? holdKeys.filter((k) => candKeys.has(k)).length / holdKeys.length : 0; retrSum += retrieved; retrN++;
    // journey-level completeness: how much of the journey the reconstructed timeline holds
    const tl = new Set(j.timeline.map((x) => x.id8)); const rec = others.filter((m) => tl.has(m)).length / others.length;
    const hit = j.application ? opps.find((o) => o.key === j.application!.key) : undefined;
    const hitShare = hit ? others.filter((m) => hit.events.some((e) => e.gmailMessageId.startsWith(m))).length / others.length : 0;
    const exp = expectOf.get(sid); const seedEv = all.find((x) => x.e.gmailMessageId.startsWith(sid))?.e;
    const semBad = !!(exp && seedEv && TYPE_OK[exp] && !TYPE_OK[exp].includes(seedEv.type));
    const vendorish = others.some((m) => all.find((x) => x.e.gmailMessageId.startsWith(m))?.e.signals.some((q) => /relation:vendor_for|class:logistics/.test(q)));
    const programish = t.kind !== "job";
    const lifeOk = stateOk(t, j.state);
    let family: string;
    if (rec >= 0.6 && lifeOk && j.decision === "resolved") { ok++; family = "OK success"; }
    else if (bestHold < 0.6) family = "G  grouping fragmentation (the product itself splits the journey: no single application holds it)";
    else if (j.decision === "no-candidate" || !holdKeys.every((k) => candKeys.has(k)) && !holdKeys.some((k) => candKeys.has(k))) family = "R  retrieval miss (the application holding the journey is not among the candidates)";
    else if (j.decision === "resolved" && hitShare < 0.5) family = "I1 identity: resolved to the WRONG application";
    else if (j.decision === "ambiguous") family = holdKeys.some((k) => j.candidates.some((c) => c.key === k && c.vetoes.length === 0)) ? "I2 identity: ambiguous, the right application was a surviving candidate" : "I3 identity: ambiguous, the right application was vetoed";
    else if (semBad) family = "S  semantic: the seed's type is wrong in the product";
    else if (!lifeOk) family = "L  lifecycle: right application, wrong final state";
    else family = "X  other (timeline incomplete)";
    add(family, `${tag} hold=${bestHold.toFixed(2)} rec=${rec.toFixed(2)} ${j.decision} life=${lifeOk ? "ok" : `${j.state?.status}/${j.state?.closedBy ?? j.state?.outcome ?? "-"} vs ${t.status}/${t.outcome ?? "-"}`}${semBad ? " SEM" : ""}${vendorish ? " VENDOR" : ""}${programish ? " PROGRAM" : ""}`);
  }
}
console.log(`${n} blind seeds (DEVELOPMENT truth). success ${ok}/${n}. Mean retrieval of the application(s) holding the journey among candidates: ${retrN ? (retrSum / retrN).toFixed(2) : "n/a"}`);
for (const [f, lines] of [...fam].sort((a, b) => b[1].length - a[1].length)) { console.log(`${String(lines.length).padStart(3)}  ${f}`); if (details) for (const l of lines) console.log(`       ${l}`); }
process.exit(0);
