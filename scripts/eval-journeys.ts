/**
 * Journey evaluation (M30 Opportunity Intelligence v3): runs the product's read path over FICTIONAL mailboxes with labelled journeys and reports, without
 * hiding failures behind one number: recruiting precision/recall, grouping (pairs, false merges, false splits), stage/status/outcome per journey, next action,
 * source evidence, review burden/precision and contradiction flagging.
 *
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/eval-journeys.ts <fixture.json> [--semantic] [--verbose] [--json out.json]
 *
 * Rules of use (docs/generalization-policy.md): a sealed fixture is run once per milestone; after its failure list is inspected it is contaminated.
 * Fixtures live OUTSIDE the repository. Nothing here reads a database or a real mailbox.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildActions } from "../lib/recruiting/actions.ts";
import { refineEvents } from "../lib/lifecycle/refine.ts";
import { buildOpportunities, eventNeedsReview } from "../lib/recruiting/opportunity.ts";
import { buildReviewQueue } from "../lib/recruiting/review.ts";
import type { EffectiveEvent, Opportunity, RecruitingEmail } from "../lib/recruiting/types.ts";
import { isNearMiss } from "../lib/reliability/flags.ts";
import { readMail } from "../lib/reliability/assess.ts";
import { reconcileReadings } from "../lib/semantic/employer.ts";
import { applyAssist, isSemanticExcluded } from "../lib/semantic/assist.ts";
import { shadowAssist, type ShadowTrace } from "../lib/decision/shadow.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { localTransport } from "../lib/semantic/local.ts";

type Msg = { id: string; threadId?: string; from: string; subject: string; body: string; receivedAt: string; outbound?: boolean; discovery?: "keyword" | "sweep"; expect: { inPipeline: boolean; type: string | null; opportunityKey: string | null } };
type Journey = { key: string; finalStage: string; finalStatus: "active" | "closed"; outcome: string | null; nextAction: string; contradiction: string | null };
type Fixture = { now: string; scenarios: { id: string; note?: string; messages: Msg[]; journeys?: Journey[] }[] };

const file = process.argv[2];
const verbose = process.argv.includes("--verbose");
const useModel = process.argv.includes("--semantic");
// --replay: cached readings ONLY. Never calls the model, never writes the cache, and a scenario missing from the cache is an error. This is the mode the regression gate uses
// (scripts/eval-gate.ts), so a decision-logic change is measured on identical model output in under a second.
const replay = process.argv.includes("--replay");
// --engine current|shadow: `current` is the product's decision chain (applyAssist); `shadow` is the evidence-ledger decision engine (lib/decision), run on the SAME readings.
const engine = process.argv.includes("--engine") ? process.argv[process.argv.indexOf("--engine") + 1] : "current";
if (engine !== "current" && engine !== "shadow") throw new Error(`unknown --engine ${engine}`);
const trace: ShadowTrace = new Map();
const perMessage: { scenario: string; id: string; expectInPipeline: boolean; expectType: string | null; gotType: string | null; state: string | null; placement: string | null; terminal: string | null; belief: number | null; verdict: unknown; ambiguous: boolean; opp: string | null }[] = [];
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const modelId = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "mlx-community/Qwen3-4B-Instruct-2507-4bit";
const reader = useModel ? createModelReader({ transport: localTransport(), model: modelId, batch: 4, idPrefix: "local", guide: SEMANTIC_GUIDE_V3_COMPACT }) : null;
// --cache <file>: model readings are saved the first time and reused afterwards, so downstream logic can be iterated on without re-running the model.
// Only valid while the guide, the inputs and the model are unchanged; delete the file after changing any of them.
const cachePath = process.argv.includes("--cache") ? process.argv[process.argv.indexOf("--cache") + 1] : null;
const cache: Record<string, [string, unknown][]> = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const fx = JSON.parse(readFileSync(file, "utf8")) as Fixture;
const now = new Date(fx.now);
const floating = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()));

const c = { tp: 0, fp: 0, fn: 0, tn: 0, typeOk: 0, typeN: 0, pairTp: 0, pairFp: 0, pairFn: 0, journeys: 0, split: 0, merged: 0, noHome: 0, statusOk: 0, outcomeOk: 0, stageOk: 0, stageN: 0, actOk: 0, actNormOk: 0, actNormN: 0, evidenceOk: 0, evidenceN: 0, contra: 0, contraFlagged: 0, contraFlaggedByField: 0, reviewItems: 0, reviewJustified: 0, reviewPossible: 0, reviewPossibleGenuine: 0, attention: 0, attentionJustified: 0, falseOppAfterNeg: 0 };
const lines: string[] = [];
const bad = (s: string) => lines.push(s);
let modelMs = 0;
const t0 = Date.now();

for (const sc of fx.scenarios) {
  const emails: RecruitingEmail[] = sc.messages.map((m) => ({ id: m.id, threadId: m.threadId ?? `t-${m.id}`, from: m.from, subject: m.subject, bodyText: m.body, receivedAt: new Date(m.receivedAt), outbound: m.outbound ?? false }));
  const disc = new Map(sc.messages.map((m) => [m.id, m.discovery ?? "keyword"]));
  let read = readMail(emails);
  if (reader) {
    const s = Date.now();
    const inputs = semanticInputs(emails);
    if (replay && !cache[sc.id]) throw new Error(`replay: scenario ${sc.id} has no cached readings (${cachePath ?? "no --cache given"})`);
    const readings = (cache[sc.id] ? new Map(cache[sc.id]) : await reader.readings!(inputs)) as Awaited<ReturnType<NonNullable<typeof reader.readings>>>;
    // --fill-missing: a model call that failed (timeout, malformed batch) leaves no reading; ask again for exactly those messages. The code under test is unchanged, so this repairs
    // the measurement's infrastructure, not the result.
    if (!replay && cache[sc.id] && process.argv.includes("--fill-missing")) {
      const missing = inputs.filter((i) => !readings.has(i.key));
      if (missing.length > 0) { const more = await reader.readings!(missing); for (const [k, v] of more) readings.set(k, v); cache[sc.id] = [...readings.entries()] as [string, unknown][]; if (cachePath) writeFileSync(cachePath, JSON.stringify(cache)); }
    }
    if (!replay && cachePath && !cache[sc.id]) { cache[sc.id] = [...readings.entries()] as [string, unknown][]; writeFileSync(cachePath, JSON.stringify(cache)); }
    const gaps = inputs.filter((i) => !readings.has(i.key)).length;
    if (gaps > 0) console.error(`[model] ${sc.id}: ${gaps} message(s) have no reading`);
    modelMs += Date.now() - s;
    const opinions = new Map([...readings].map(([k, v]) => [k, v.output] as const));
    read = reconcileReadings(engine === "shadow" ? shadowAssist(read, emails, opinions, trace) : applyAssist(read, emails, opinions), readings);
  }
  const effective: EffectiveEvent[] = read.map((e) => ({ ...e, signals: disc.get(e.gmailMessageId) === "sweep" ? [...e.signals, "via:sweep"] : e.signals, id: e.gmailMessageId, corrected: false }));
  const all = refineEvents(effective).events;
  const possible = all.filter((e) => isNearMiss(e) && !isSemanticExcluded(e));
  const events = all.filter((e) => !isNearMiss(e));
  const opps: Opportunity[] = buildOpportunities(events);
  const actions = buildActions(opps, floating);
  const queue = buildReviewQueue(opps, undefined, possible, floating);

  const byMsg = new Map<string, { opp: Opportunity; type: string; ambiguous: boolean }>();
  for (const o of opps) for (const e of o.events) byMsg.set(e.gmailMessageId, { opp: o, type: e.type, ambiguous: e.signals.includes("identity:ambiguous") });
  const msgs = sc.messages.filter((m) => !m.outbound);
  const msgById = new Map(sc.messages.map((m) => [m.id, m]));

  // 1. recruiting P/R and stage type
  for (const m of msgs) {
    const got = byMsg.get(m.id);
    const tv = trace.get(m.id);
    perMessage.push({ scenario: sc.id, id: m.id, expectInPipeline: m.expect.inPipeline, expectType: m.expect.type, gotType: got?.type ?? null, state: tv?.state ?? null, placement: tv?.placement ?? null, terminal: tv?.terminal ?? null, ambiguous: got?.ambiguous ?? false, opp: got ? got.opp.key : null, belief: tv?.recruiting.belief ?? null, verdict: tv ? { reasons: tv.reasons, for: tv.recruiting.for, against: tv.recruiting.against, type: tv.type.value, typeFor: tv.type.for, typeAgainst: tv.type.against } : null });
    if (m.expect.inPipeline && got) { c.tp++; if (m.expect.type) { c.typeN++; if (got.type === m.expect.type) c.typeOk++; else bad(`${sc.id}/${m.id} TYPE ${got.type} != ${m.expect.type} :: ${m.subject}`); } }
    else if (m.expect.inPipeline) { c.fn++; bad(`${sc.id}/${m.id} MISSED (${m.expect.type}) :: ${m.subject}`); }
    else if (got) { c.fp++; bad(`${sc.id}/${m.id} FALSE POSITIVE as ${got.type} :: ${m.subject}`); }
    else c.tn++;
  }
  // 2. grouping: pairs
  for (let i = 0; i < msgs.length; i++) for (let j = i + 1; j < msgs.length; j++) {
    const a = msgs[i], b = msgs[j];
    if (!a.expect.inPipeline || !b.expect.inPipeline) continue;
    const same = a.expect.opportunityKey !== null && a.expect.opportunityKey === b.expect.opportunityKey;
    const ga = byMsg.get(a.id), gb = byMsg.get(b.id);
    const grouped = !!ga && !!gb && ga.opp === gb.opp;
    if (same && grouped) c.pairTp++;
    else if (same && ga && gb) { c.pairFn++; if (verbose) bad(`${sc.id} SPLIT ${a.expect.opportunityKey}: ${a.subject} | ${b.subject}`); }
    else if (!same && grouped) { c.pairFp++; bad(`${sc.id} WRONG MERGE ${a.expect.opportunityKey} + ${b.expect.opportunityKey}: ${a.subject} | ${b.subject}`); }
  }
  // 3. per journey: home opportunity, splits, stage/status/outcome, next action, evidence, contradiction
  const journeyMsgs = new Map<string, Msg[]>();
  for (const m of msgs) if (m.expect.inPipeline && m.expect.opportunityKey) journeyMsgs.set(m.expect.opportunityKey, [...(journeyMsgs.get(m.expect.opportunityKey) ?? []), m]);
  const homeOf = new Map<string, Opportunity>();
  for (const j of sc.journeys ?? []) {
    const jm = journeyMsgs.get(j.key) ?? [];
    c.journeys++;
    const tally = new Map<Opportunity, number>();
    for (const m of jm) { const g = byMsg.get(m.id); if (g) tally.set(g.opp, (tally.get(g.opp) ?? 0) + 1); }
    if (tally.size === 0) { c.noHome++; bad(`${sc.id}/${j.key} JOURNEY NOT FOUND`); if (j.contradiction) c.contra++; continue; }
    if (tally.size > 1) { c.split++; bad(`${sc.id}/${j.key} JOURNEY SPLIT over ${tally.size} opportunities`); }
    const home = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    homeOf.set(j.key, home);
    const owners = new Set<string>();
    for (const e of home.events) { const m = msgById.get(e.gmailMessageId); if (m?.expect.opportunityKey && m.expect.inPipeline) owners.add(m.expect.opportunityKey); }
    if (owners.size > 1) { c.merged++; bad(`${sc.id}/${j.key} OPPORTUNITY MERGES journeys ${[...owners].join(" + ")}`); }
    // an ACCEPTED offer is settled but stays in the pipeline (a real job to prepare for); the person-facing question it answers is `outcome`, so status is not scored for it
    const statusOk = j.outcome === "accepted" || home.status === j.finalStatus;
    const outcomeNorm = (home.outcome ?? null) as string | null;
    const outcomeOk = outcomeNorm === (j.outcome ?? null) || (j.outcome === "accepted" && outcomeNorm === "offer" && false);
    if (statusOk) c.statusOk++; else bad(`${sc.id}/${j.key} STATUS ${home.status} != ${j.finalStatus}`);
    if (outcomeOk) c.outcomeOk++; else bad(`${sc.id}/${j.key} OUTCOME ${outcomeNorm} != ${j.outcome}`);
    if (j.finalStage !== "closed" || j.outcome === "rejected" || j.outcome === "withdrawn") {
      c.stageN++;
      if (home.stage === j.finalStage) c.stageOk++; else bad(`${sc.id}/${j.key} STAGE ${home.stage} != ${j.finalStage}`);
    }
    // next action
    const mine = actions.filter((a) => a.opportunityKey === home.key).sort((a, b) => b.priority - a.priority);
    const got = mine[0]?.kind ?? "none";
    if (got === j.nextAction) c.actOk++; else bad(`${sc.id}/${j.key} NEXT ACTION ${got} != ${j.nextAction}`);
    // The product time-boxes actions (an invitation older than 30 days is "probably gone"), and the fixtures end months before their `now`. So the lifecycle logic is ALSO
    // scored with the clock set 3 days after the journey's last message, for the kinds of action that depend on evidence rather than on the calendar.
    if (["schedule_interview", "respond_recruiter", "offer_decision", "assessment_deadline", "none"].includes(j.nextAction)) {
      const lastAt = Math.max(...home.events.map((e) => e.occurredAt.getTime()));
      const at = new Date(lastAt + 3 * 86_400_000);
      const near = buildActions([home], new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 12)))[0]?.kind ?? "none";
      c.actNormN++; if (near === j.nextAction) c.actNormOk++; else if (verbose) bad(`${sc.id}/${j.key} NEXT ACTION (age-normalized) ${near} != ${j.nextAction}`);
    }
    if (mine[0]) { c.evidenceN++; const threads = new Set(jm.map((m) => m.threadId ?? `t-${m.id}`)); if (mine[0].sourceThreadId && threads.has(mine[0].sourceThreadId)) c.evidenceOk++; else bad(`${sc.id}/${j.key} EVIDENCE action points outside the journey`); }
    // contradiction
    if (j.contradiction) {
      c.contra++;
      const flaggedByReview = queue.some((q) => q.opportunityKey === home.key && !q.weak);
      const field = ((home as unknown as { contradictions?: unknown[] }).contradictions ?? []).length > 0;
      if (flaggedByReview || field) c.contraFlagged++;
      if (field) c.contraFlaggedByField++;
      if (!flaggedByReview && !field) bad(`${sc.id}/${j.key} CONTRADICTION not flagged: ${j.contradiction}`);
    }
  }
  // 4. review burden: an item is justified when it questions something that is actually wrong, or touches a labelled contradiction, or is a genuine missed opportunity
  const contraKeys = new Set((sc.journeys ?? []).filter((j) => j.contradiction).map((j) => j.key));
  for (const q of queue) {
    if (q.weak) continue;
    const m = msgById.get(q.event.gmailMessageId);
    c.reviewItems++;
    let justified = false;
    if (q.possible) { c.reviewPossible++; justified = !!m?.expect.inPipeline; if (justified) c.reviewPossibleGenuine++; }
    else if (m) justified = !m.expect.inPipeline || m.expect.type !== q.event.type || (!!m.expect.opportunityKey && contraKeys.has(m.expect.opportunityKey));
    if (justified) c.reviewJustified++; else if (verbose) bad(`${sc.id}/${q.event.gmailMessageId} REVIEW unnecessary (${q.possible ? "possible" : q.event.type}, co=${q.event.company}/${q.event.fieldConfidence?.company}, type=${q.event.fieldConfidence?.type}) :: ${m?.subject} :: ${q.reasons.join(" | ").slice(0, 120)}`);
    if (q.tier === "important") { c.attention++; if (justified) c.attentionJustified++; }
  }
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const total = c.tp + c.fp + c.fn + c.tn;
const out = [
  `fixture ${file.split("/").pop()}  engine ${engine}  mode ${useModel ? "hybrid (rules + local model)" : "rules only"}  messages ${total}  journeys ${c.journeys}`,
  `recruiting:  precision ${pct(c.tp, c.tp + c.fp)} (${c.fp} false)  recall ${pct(c.tp, c.tp + c.fn)} (${c.fn} missed)  stage type ${pct(c.typeOk, c.typeN)}`,
  `grouping:    pair precision ${pct(c.pairTp, c.pairTp + c.pairFp)} recall ${pct(c.pairTp, c.pairTp + c.pairFn)}  wrong merges ${c.pairFp}  missed links ${c.pairFn}  | journeys split ${c.split}  opportunities merging journeys ${c.merged}  journeys not found ${c.noHome}`,
  `lifecycle:   status ${pct(c.statusOk, c.journeys - c.noHome)}  outcome ${pct(c.outcomeOk, c.journeys - c.noHome)}  stage ${pct(c.stageOk, c.stageN)}`,
  `next action: as shipped at fixture time ${pct(c.actOk, c.journeys - c.noHome)}, evidence-only (clock 3 days after the last message) ${pct(c.actNormOk, c.actNormN)}  source evidence ${pct(c.evidenceOk, c.evidenceN)}`,
  `contradict.: flagged ${c.contraFlagged}/${c.contra} (explicit detector: ${c.contraFlaggedByField})`,
  `review:      ${c.reviewItems} items, justified ${pct(c.reviewJustified, c.reviewItems)} (unnecessary ${c.reviewItems - c.reviewJustified}); "important" ${c.attention} (justified ${pct(c.attentionJustified, c.attention)}); possibles ${c.reviewPossible} (${c.reviewPossibleGenuine} genuine)`,
  `time:        total ${((Date.now() - t0) / 1000).toFixed(1)} s${reader ? `, model ${(modelMs / 1000).toFixed(0)} s` : ""}`,
];
console.log(out.join("\n"));
if (verbose) for (const l of lines) console.log(" -", l);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ engine, counts: c, summary: out, failures: lines, perMessage }, null, 1));
void eventNeedsReview;
