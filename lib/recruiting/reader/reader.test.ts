import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getCached, inputHash, putCached } from "./cache.ts";
import { passGate } from "./gate.ts";
import { GUIDE_V2, READER_VERSION } from "./guide.ts";
import { reconcile, sameOrg, type Reading } from "./reconcile.ts";
import { buildReaderInput, redact } from "./redact.ts";
import { labelViewRole, labelViewType, toReaderType } from "./taxonomy.ts";
import type { ReaderInput } from "./types.ts";
import { auditGrounding, verifyOutput } from "./verify.ts";

const input = (o: Partial<ReaderInput> = {}): ReaderInput => ({
  key: "k1", from: "Acme Recruiting @acme.com", subject: "Your application to Acme",
  body: "Thank you for applying for the Software Engineer Intern role. Please complete the assessment by Nov 7, 2026. The Future Leaders Program starts soon.",
  received: "2026-11-01T12:00:00Z", threadMessages: 1, candidates: [{ id: "c1", name: "Acme" }, { id: "c2", name: "Greenhouse" }], ...o,
});
const good = { key: "k1", recruiting: "yes", type: "assessment", stage: "assessment", company_candidate: "c1", company_quote: null, role_quote: "Software Engineer Intern", date_quote: "Nov 7, 2026", evidence_quote: "Please complete the assessment", certainty: "high" };

test("a fully grounded output survives verification unchanged", () => {
  const v = verifyOutput(good, input());
  assert.equal(v.status, "ok");
  assert.deepEqual([v.type, v.stage, v.company, v.role, v.dateText], ["assessment", "assessment", "Acme", "Software Engineer Intern", "Nov 7, 2026"]);
  assert.deepEqual(v.rejections, []);
  assert.ok(v.evidence && v.evidence.hash.length === 16);
  assert.deepEqual(auditGrounding(v, input()), []);
});

test("unsupported values are dropped, never repaired", () => {
  const i = input();
  const bad = verifyOutput({ ...good, role_quote: "Staff Rocket Scientist", date_quote: "Dec 25, 2030", company_candidate: "c9" }, i);
  assert.equal(bad.role, null); assert.equal(bad.dateText, null); assert.equal(bad.company, null);
  assert.deepEqual(bad.rejections.sort(), ["company:unknown_candidate", "date:quote_not_in_text", "role:quote_not_in_text"]);
  assert.equal(verifyOutput({ ...good, role_quote: "Future Leaders Program" }, i).rejections.includes("role:program_name"), true);
  assert.equal(verifyOutput({ ...good, company_candidate: null, company_quote: "Greenhouse" }, input({ body: input().body + " via Greenhouse" })).company, null);
  assert.equal(verifyOutput({ ...good, company_candidate: null, company_quote: "Julia Ngo" }, input({ body: input().body + " Julia Ngo" })).company, null);
});

test("a company quote must be in the text; a yes needs real evidence; wrong key or shape is invalid", () => {
  const q = verifyOutput({ ...good, company_candidate: null, company_quote: "Globex Corporation" }, input());
  assert.equal(q.company, null); assert.ok(q.rejections.includes("company:quote_not_in_text"));
  const ok = verifyOutput({ ...good, company_candidate: null, company_quote: "Acme Recruiting" }, input());
  assert.equal(ok.company, "Acme Recruiting"); assert.equal(ok.companySource, "quote");
  assert.equal(verifyOutput({ ...good, evidence_quote: "something never said" }, input()).status, "unsupported_yes");
  assert.equal(verifyOutput({ ...good, key: "other" }, input()).status, "invalid");
  assert.equal(verifyOutput("nope", input()).status, "invalid");
  assert.equal(verifyOutput({ ...good, certainty: "very" }, input()).status, "invalid");
  const no = verifyOutput({ key: "k1", recruiting: "no", type: "applied", stage: null, evidence_quote: null, certainty: "high" }, input());
  assert.equal(no.status, "ok"); assert.equal(no.type, null); // a "no" carries no structured fields
});

const R = (o: Partial<Reading> = {}): Reading => ({ recruiting: true, type: "rejection", company: "Acme", role: null, ...o });
const M = (o: Record<string, unknown> = {}) => ({ ...verifyOutput({ ...good, type: "rejection", stage: "closed", role_quote: null, date_quote: null }, input()), ...o }) as ReturnType<typeof verifyOutput>;

test("reconcile: agreement is confident, disagreement and abstention are review, never silently resolved", () => {
  assert.equal(reconcile(R(), M()).state, "recruiting");
  assert.equal(reconcile(R({ recruiting: false, type: null, company: null }), null).state, "not_recruiting");
  const dis = reconcile(R(), M({ recruiting: false, type: null }));
  assert.equal(dis.state, "review"); assert.equal(dis.reason, "disagree"); assert.equal(dis.modelSuggests, "not_recruiting");
  assert.equal(reconcile(R({ recruiting: false }), M()).modelSuggests, "recruiting");
  assert.equal(reconcile(R(), M({ certainty: "low" })).reason, "model_abstained");
  assert.equal(reconcile(R(), M({ status: "unsupported_yes" })).state, "review");
  assert.equal(reconcile(R(), null).state, "review"); // rules say yes, the gate never sent it to the model: model "no"
});

test("reconcile fields: type conflict is flagged, fuller explicit company wins, program names are not roles", () => {
  const t = reconcile(R({ type: "status_update" }), M({ certainty: "medium" }));
  assert.equal(t.typeReview, true); assert.equal(t.type, "status_update");
  assert.equal(reconcile(R({ type: "status_update" }), M()).type, "rejection"); // high-certainty model decides, still flagged
  assert.equal(reconcile(R({ company: "Texas" }), M({ company: "Texas Instruments" })).company, "Texas Instruments");
  assert.equal(reconcile(R({ company: "Acme" }), M({ company: "Globex" })).companyReview, true);
  assert.equal(reconcile(R({ role: "Future Leaders Program" }), M({ role: null })).role, null);
  assert.equal(sameOrg("Heidelberg Laureate Forum", "Heidelberg Laureate Forum Foundation"), true);
});

test("guide v2 taxonomy: follow_up and assessment_completed collapse; the stored label is only read through a view", () => {
  assert.equal(toReaderType("follow_up"), "status_update");
  assert.equal(toReaderType("assessment_completed"), "status_update");
  assert.equal(toReaderType("rejection"), "rejection");
  assert.equal(labelViewType("applied", "assessment"), "assessment");
  assert.equal(labelViewType("applied", "applied"), "applied");
  assert.equal(labelViewType("unknown", "x"), "unknown");
  assert.equal(labelViewRole("Future Leaders Program"), "not_applicable");
  assert.equal(labelViewRole("Software Engineer Intern"), "Software Engineer Intern");
  assert.equal(labelViewRole("unknown"), "unknown");
  assert.match(GUIDE_V2, /program, fellowship, cohort or event name is NOT a role/);
});

test("redaction removes links, addresses, long numbers and the supplied self names, and truncates", () => {
  const r = redact("Hi Ada Lovelace, see https://x.example/a?t=1 or mail ada@x.com code 924086 &amp; more", ["Ada", "Lovelace"]);
  assert.ok(!/https|@x\.com|924086|Ada|Lovelace/.test(r), r);
  const email = { id: "m", threadId: "t", from: "Ada Lovelace <jobs@acme.com>", subject: "s", bodyText: "x".repeat(5000), receivedAt: new Date("2026-01-01T00:00:00Z"), outbound: false };
  const built = buildReaderInput(email, "k", ["A", "B", "C", "D", "E", "F", "G"], 3, ["Ada"]);
  assert.equal(built.body.length, 1400); assert.equal(built.candidates.length, 5); assert.ok(!built.from.includes("Ada"));
});

test("gate: a rules 'yes' always passes; generic marketing does not; bulk mail that never talks about your process is skipped", () => {
  const mail = (subject: string, bodyText: string, from = "Acme <hr@acme.com>") => ({ from, subject, bodyText });
  assert.equal(passGate("G2-process-unbulk", mail("Weekly digest", "Fresh deals"), true), true);
  assert.equal(passGate("G2-process-unbulk", mail("Weekly digest", "Fresh deals for you. Unsubscribe"), false), false);
  assert.equal(passGate("G2-process-unbulk", mail("Thanks", "Thank you for applying. Unsubscribe"), false), true);
  assert.equal(passGate("G2-process-unbulk", mail("Hello", "x", "Greenhouse <no-reply@greenhouse.io>"), false), true);
  assert.equal(passGate("G0-loose", mail("Internship fair", "Free pizza"), false), true);
});

test("the cache stores verified outputs, never the model input or quote text, and is keyed by reader version", () => {
  const dir = mkdtempSync(join(tmpdir(), "reader-cache-"));
  process.env.READER_CACHE_DIR = dir;
  const i = input(); const v = verifyOutput(good, i);
  putCached(i, "A", v);
  assert.deepEqual(getCached(i, "A")?.type, "assessment");
  assert.equal(getCached(i, "B"), null);
  assert.equal(getCached(input({ body: "different" }), "A"), null);
  assert.equal(inputHash(i), inputHash(input()));
  const stored = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("");
  assert.ok(!stored.includes("Please complete the assessment") && !stored.includes("Thank you for applying"), "no message text in the cache");
  assert.match(stored, new RegExp(READER_VERSION));
  delete process.env.READER_CACHE_DIR;
});
