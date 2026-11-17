import assert from "node:assert/strict";
import test from "node:test";
import { inheritRoles, isContinuityCandidate, outboundEvent, type ThreadAnchor } from "../recruiting/extract.ts";
import { buildPredictions, type Prediction } from "../recruiting/predictions.ts";
import type { ReaderInput, VerifiedOutput } from "../recruiting/reader/types.ts";
import { runSync, type EngineParams, type MailSource, type SyncStore } from "../recruiting/sync-engine.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { readMail } from "../reliability/assess.ts";
import { isNearMiss, isWeakNearMiss, hasDoubt } from "../reliability/flags.ts";
import { SECOND_READER_NO, SECOND_READER_YES, applyConsensus } from "./consensus.ts";
import { semanticInputs } from "./inputs.ts";
import { usable, type SemanticReader } from "./port.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const IMP = ["INBOX", "IMPORTANT"];
const mail = (id: string, from: string, subject: string, body: string, labels = IMP, extra: Partial<RecruitingEmail> = {}): RecruitingEmail => ({ id, threadId: `t-${id}`, from, subject, receivedAt: NOW, outbound: false, bodyText: body, labels, ...extra });
const op = (recruiting: boolean, over: Partial<VerifiedOutput> = {}): VerifiedOutput => ({ key: "k", status: "ok", recruiting, type: recruiting ? "status_update" : null, stage: null, company: null, companySource: null, role: null, dateText: null, certainty: "high", evidence: null, rejections: [], ...over });

// A message the rules read confidently; one they do not recognise at all; a weak structural near miss.
const APPLIED = mail("a", "Acme <jobs@us.greenhouse-mail.io>", "Thank you for applying to Acme", "Thank you for applying to the Backend Engineer Intern position at Acme. We received your application.");
const UNFAMILIAR = mail("u", "Robin <robin.ames@summit-ai.example>", "Reference", "We would like two references. Could you send their details? Reply when you can.", ["INBOX"]);
const WEAK = mail("w", "Casey <casey.park@quill-labs.example>", "grab a time", "Grab any slot here for a chat about the Analytics Intern opening at Quill.");

test("consensus: each arm of the policy, and agreement or abstention changes nothing", () => {
  const events = readMail([APPLIED, UNFAMILIAR, WEAK]);
  const byId = (es: ExtractedEvent[], id: string) => es.find((e) => e.gmailMessageId === id);
  assert.equal(byId(events, "u"), undefined, "precondition: the rules show nothing for it");
  assert.ok(byId(events, "w") && isWeakNearMiss(byId(events, "w")!), "precondition: weak near miss");

  const out = applyConsensus(events, [APPLIED, UNFAMILIAR, WEAK], new Map([["u", op(true)], ["w", op(true)], ["a", op(false)]]));
  const u = byId(out, "u")!;
  assert.ok(isNearMiss(u) && !isWeakNearMiss(u), "invisible mail the second reader recognises becomes a counted 'possibly recruiting'");
  assert.deepEqual(u.reviewReasons, [SECOND_READER_YES]);
  assert.ok(!isWeakNearMiss(byId(out, "w")!), "a weak near miss it recognises is promoted to counted");
  const a = byId(out, "a")!;
  assert.ok(hasDoubt(a) && a.reviewReasons!.includes(SECOND_READER_NO), "a confident rules event it rejects becomes visible doubt");

  const unchanged = applyConsensus(events, [APPLIED, UNFAMILIAR, WEAK], new Map([["a", op(true)], ["w", op(false)]]));
  assert.ok(!hasDoubt(byId(unchanged, "a")!), "agreement adds no doubt");
  assert.equal(byId(unchanged, "u"), undefined, "no opinion, no effect");
});

test("a strong structural near miss that the second reader rejects is folded, not dropped", () => {
  const strong = mail("s", "Dana <dana.reyes@brightpath.example>", "Quick note", "About your candidacy for the Backend Engineer Intern role: the team has gone another direction for this cycle.");
  const events = readMail([strong]);
  assert.ok(isNearMiss(events[0]) && !isWeakNearMiss(events[0]));
  const out = applyConsensus(events, [strong], new Map([["s", op(false)]]));
  assert.ok(isNearMiss(out[0]) && isWeakNearMiss(out[0]), "still offered, no longer counted");
});

test("abstentions, low certainty and unverified outputs have no effect at all", () => {
  const events = readMail([APPLIED, UNFAMILIAR]);
  for (const o of [op(true, { certainty: "low" }), op(false, { certainty: "low" }), op(true, { status: "invalid" }), op(true, { status: "unsupported_yes" })]) {
    assert.equal(usable(o), false);
    assert.deepEqual(applyConsensus(events, [APPLIED, UNFAMILIAR], new Map([["a", o], ["u", o]])), events);
  }
});

test("THE CONTRACT: whatever the second reader says, no structured value of any event changes", () => {
  const emails = [APPLIED, UNFAMILIAR, WEAK];
  const events = readMail(emails);
  const fields = (e: ExtractedEvent) => JSON.stringify([e.type, e.company, e.role, e.eventDate, e.dateKind, e.fieldConfidence]);
  const before = new Map(events.map((e) => [e.gmailMessageId, fields(e)]));
  for (const yes of [true, false]) {
    // even an opinion that carries a company, role and date of its own must not leak into the event
    const hostile = op(yes, { company: "Initech", role: "Quantitative Researcher", dateText: "January 1", type: "offer" });
    for (const e of applyConsensus(events, emails, new Map(emails.map((m) => [m.id, hostile])))) {
      if (before.has(e.gmailMessageId)) assert.equal(fields(e), before.get(e.gmailMessageId), `${e.gmailMessageId} changed`);
      else assert.equal(e.company?.toLowerCase().includes("initech") ?? false, false, "an added candidate takes its company from the resolver only");
    }
  }
});

// ------------------------------------------------------------------ what the second reader may see
test("inputs are redacted, truncated, triaged and local: nothing a reader must not see reaches it", () => {
  const secret = "https://tracking.example/secret/token ".repeat(3) + "write me at sam.rivera@mail.example or 4155550123456";
  const hiring = mail("h", "Priya Nair <priya.nair@acme.com>", "Hi Sam Rivera: your interview", `Hi Sam Rivera, we would like to schedule your interview. ${secret} ${"x".repeat(5000)}`);
  const shipping = mail("p", "ShopCo <orders@shopco.example>", "Your order has shipped", "Your order #4471 has shipped. Tracking number inside. Free shipping on your next order.");
  const outbound = mail("o", "Sam <sam.rivera@mail.example>", "Re: interview", "Thursday works.", IMP, { outbound: true });
  const inputs = semanticInputs([hiring, shipping, outbound], ["Sam", "Rivera"]);
  assert.deepEqual(inputs.map((i) => i.key), ["h"], "commerce mail and the user's own messages are never sent");
  const sent = JSON.stringify(inputs);
  for (const leak of ["sam.rivera@", "tracking.example", "4155550123456", "Rivera", "https://"]) assert.ok(!sent.includes(leak), `leaked ${leak}`);
  assert.ok(inputs[0].body.length <= 1400, "truncated");
  assert.ok(sent.includes("[candidate]") && sent.includes("[link]"), "redacted, not removed");
});

// ------------------------------------------------------------------ the engine
const source = (all: RecruitingEmail[]): MailSource => ({
  async listCandidates() { return all.map((e) => ({ id: e.id, threadId: e.threadId })); },
  async fetchEmails(ids) { return { emails: all.filter((e) => ids.includes(e.id)), missing: [] }; },
  async fetchOutbound() { return []; },
});
function memoryStore() {
  const events = new Map<string, ExtractedEvent>(), predictions = new Map<string, Prediction>();
  const store: SyncStore = {
    async evaluatedIds(ids) { return new Set(ids.filter((i) => predictions.has(i))); },
    async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
    async savePredictions(ps) { for (const p of ps) if (!predictions.has(p.gmailMessageId)) predictions.set(p.gmailMessageId, p); },
    async prune() {}, async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
    async inheritRoles() { inheritRoles([...events.values()]); }, async finish() { return { events: events.size }; },
  };
  return { store, events, predictions };
}
const params = (over: Partial<EngineParams> = {}): EngineParams => ({ maxCandidates: 600, threadsPerChunk: 5, budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract: readMail, deferable: isContinuityCandidate, predict: (e) => buildPredictions(e), outboundEvent, ...over });
const fake = (answer: (i: ReaderInput) => VerifiedOutput | undefined, seen: ReaderInput[][] = []): SemanticReader => ({ id: "fake", async opine(inputs) { seen.push(inputs); return new Map(inputs.flatMap((i) => { const o = answer(i); return o ? [[i.key, o] as const] : []; })); } });

test("ENGINE: off by default (no reader, no call, identical output); on, it surfaces invisible mail without touching the pipeline", async () => {
  const mails = [APPLIED, UNFAMILIAR];
  const off = memoryStore();
  await runSync(source(mails), off.store, params());
  assert.equal(off.events.has("u"), false, "the rules alone show nothing for it");

  const seen: ReaderInput[][] = [];
  const on = memoryStore();
  await runSync(source(mails), on.store, params({ semantic: fake((i) => op(i.key === "u"), seen) }));
  assert.ok(isNearMiss(on.events.get("u")!), "surfaced");
  assert.equal(on.events.get("a")!.company, off.events.get("a")!.company, "the confident event is the same event");
  assert.equal(on.predictions.get("u")!.decision, "not_recruiting", "never logged as a recruiting decision");
  assert.ok(on.predictions.get("u")!.signals.includes("near-miss"));
  assert.ok(seen.length > 0 && seen.flat().every((i) => /^\[?/.test(i.body)), "the reader was given inputs");
});

test("ENGINE: a second reader that throws changes nothing", async () => {
  const baseline = memoryStore(), broken = memoryStore();
  await runSync(source([APPLIED, UNFAMILIAR]), baseline.store, params());
  await runSync(source([APPLIED, UNFAMILIAR]), broken.store, params({ semantic: { id: "broken", async opine() { throw new Error("down"); } } }));
  assert.deepEqual([...broken.events.keys()].sort(), [...baseline.events.keys()].sort());
});
