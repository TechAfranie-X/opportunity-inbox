import assert from "node:assert/strict";
import test from "node:test";
import { resolveBatch, resolveCompany, inferVendorDomains, DEFAULT_RESOLVER_CONFIG, type ResolveInput } from "./resolve.ts";
import { classifySender, tenantsFromText } from "./vendors.ts";

const r = (o: Partial<ResolveInput>) => resolveCompany({ from: "", subject: "", body: "", ...o });
const names = (x: ReturnType<typeof r>) => x.entity?.name ?? null;

test("I3 corroboration: an employer domain plus the same name in the subject is confident", () => {
  const x = r({ from: "Acme Recruiting <jobs@acme.com>", subject: "Your Acme online assessment", body: "Please complete your coding assessment." });
  assert.equal(names(x), "Acme");
  assert.ok(x.confidence >= 0.8, `confidence ${x.confidence}`);
  assert.ok(!x.reviewRequired);
  assert.ok(new Set(x.evidence.map((e) => e.source)).size >= 2);
});

test("I1 the transport is not the subject: an ATS sender alone never yields an employer, and never yields the ATS", () => {
  for (const from of ["Greenhouse <no-reply@greenhouse.io>", "Workday <noreply@myworkday.com>", "Lever <hello@lever.co>", "Ashby <no-reply@ashbyhq.com>", "HackerRank <no-reply@hackerrank.com>"]) {
    const x = r({ from, subject: "Your application", body: "Thanks for your interest." });
    assert.equal(x.entity, null, `${from} -> ${names(x)}`);
    assert.ok(x.reviewRequired);
    assert.ok(!/greenhouse|workday|lever|ashby|hackerrank/i.test(JSON.stringify(x.alternatives)), "a vendor must not appear as an alternative employer");
  }
});

test("I1 a vendor sender still resolves when the content names the employer (subject + display name agree)", () => {
  const x = r({ from: "Acme Recruiting <no-reply@greenhouse.io>", subject: "Thank you for applying to Acme", body: "" });
  assert.equal(names(x), "Acme");
  assert.equal(x.senderKind, "ats");
});

test("I1 free mail is not an employer either", () => {
  const x = r({ from: "Sam Lee <samlee@gmail.com>", subject: "Opportunity at Acme", body: "I'm a recruiter at Acme." });
  assert.equal(x.senderKind, "freemail");
  assert.equal(names(x), "Acme");
  assert.ok(!x.evidence.some((e) => e.source === "sender_domain"));
});

test("I2 a vendor-assigned tenant identifies the employer (Workday address, ATS links)", () => {
  assert.equal(names(r({ from: "acme@myworkday.com", subject: "Update on your application", body: "" })), "Acme");
  const link = r({ from: "no-reply@greenhouse.io", subject: "Application received", body: "View your application at https://boards.greenhouse.io/initech/jobs/123" });
  assert.equal(names(link), "Initech");
  assert.ok(link.evidence.some((e) => e.source === "ats_tenant"));
  assert.deepEqual(tenantsFromText("see https://jobs.lever.co/globex and https://www.example.com").map((t) => t.slug), ["globex"]);
  assert.deepEqual(tenantsFromText("https://boards.greenhouse.io/embed/x"), []); // shared path words are not tenants
});

test("I3 a single weak source is not enough: body-only evidence is withheld or flagged", () => {
  const x = r({ from: "no-reply@greenhouse.io", subject: "Next steps", body: "We are excited about your interest in joining Acme." });
  assert.ok(x.reviewRequired, `confidence ${x.confidence}`);
  assert.ok(x.confidence < DEFAULT_RESOLVER_CONFIG.reviewBelow);
});

test("I4 disagreement lowers confidence and is surfaced, not hidden", () => {
  const agree = r({ from: "jobs@acme.com", subject: "Thank you for applying to Acme", body: "" });
  const conflict = r({ from: "jobs@acme.com", subject: "Thank you for applying to Globex", body: "" });
  assert.ok(conflict.confidence < agree.confidence);
  assert.ok(conflict.reasons.some((x) => /conflicting candidate/.test(x)));
  assert.ok(conflict.alternatives.length >= 1);
  assert.ok(conflict.reviewRequired);
});

test("I5 a domain that serves several employers is a vendor: learned from the mailbox, then ignored as an employer", () => {
  const items = [
    { id: "1", threadId: "t1", from: "Talent <jobs@hiringhub.io>", subject: "Thank you for applying to Acme", body: "" },
    { id: "2", threadId: "t2", from: "Talent <jobs@hiringhub.io>", subject: "Thank you for applying to Globex", body: "" },
    { id: "3", threadId: "t3", from: "Talent <jobs@hiringhub.io>", subject: "Your application", body: "" },
  ];
  assert.equal(classifySender("hiringhub.io"), "employer"); // unknown to the static list
  const alone = resolveCompany(items[2]);
  assert.equal(names(alone), "Hiringhub"); // without the cross-message insight the unknown vendor becomes the employer
  const out = resolveBatch(items);
  assert.equal(out.get("1")!.entity?.name, "Acme");
  assert.equal(out.get("2")!.entity?.name, "Globex");
  assert.equal(out.get("3")!.senderKind, "unknown_vendor");
  assert.equal(out.get("3")!.entity, null);
  assert.deepEqual([...inferVendorDomains([{ domain: "a.com", companyKey: "x" }, { domain: "a.com", companyKey: "x" }, { domain: "b.com", companyKey: "y" }, { domain: "b.com", companyKey: "z" }])], ["b.com"]);
});

test("I6 a person's name is the recruiter, not the company", () => {
  const x = r({ from: "Julia Ngo <julia@greenhouse.io>", subject: "Quick chat?", body: "" });
  assert.equal(x.entity, null);
  assert.equal(x.recruiter, "Julia Ngo");
});

test("reply-to on a company domain rescues a vendor-sent message", () => {
  const x = r({ from: "Careers <no-reply@greenhouse.io>", replyTo: "recruiting@initech.com", subject: "Interview confirmed", body: "Looking forward to meeting you at Initech." });
  assert.equal(names(x), "Initech");
  assert.ok(x.evidence.some((e) => e.source === "reply_to_domain"));
});

test("'X via Y' display names name the originator", () => {
  assert.equal(names(r({ from: "Umbrella Corp via Greenhouse <no-reply@greenhouse.io>", subject: "Application update", body: "" })), "Umbrella Corp");
});

test("thread context lifts a message that has no evidence of its own", () => {
  const items = [
    { id: "a", threadId: "t", from: "Acme <jobs@acme.com>", subject: "Your Acme assessment", body: "" },
    { id: "b", threadId: "t", from: "no-reply@greenhouse.io", subject: "Re: your assessment", body: "" },
  ];
  const out = resolveBatch(items);
  assert.equal(out.get("b")!.entity?.name, "Acme");
  assert.ok(out.get("b")!.evidence.some((e) => e.source === "thread"));
});

test("a company the user already tracks raises belief in a matching candidate but never creates one", () => {
  const base = { from: "jobs@acme.com", subject: "Update", body: "" };
  const without = resolveCompany(base);
  const withCtx = resolveCompany({ ...base, knownCompanies: ["Acme"] });
  assert.ok(withCtx.confidence > without.confidence);
  assert.equal(resolveCompany({ from: "no-reply@greenhouse.io", subject: "Update", body: "", knownCompanies: ["Acme"] }).entity, null);
});

test("aliases unify one brand: makenotion.com and Notion are one key", () => {
  const x = r({ from: "Careers <jobs@makenotion.com>", subject: "Thank you for applying to Notion", body: "" });
  assert.equal(x.entity?.key, "notion");
  assert.equal(x.entity?.name, "Notion");
});

test("output is deterministic and lists its evidence", () => {
  const input = { from: "Acme Recruiting <jobs@acme.com>", subject: "Your Acme online assessment", body: "Please complete your coding assessment." };
  assert.equal(JSON.stringify(resolveCompany(input)), JSON.stringify(resolveCompany(input)));
  const x = resolveCompany(input);
  assert.ok(x.evidence.length >= 2 && x.evidence.every((e) => e.detail && e.weight > 0));
});

test("stricter thresholds trade coverage for caution: the same evidence is withheld", () => {
  const input = { from: "Acme Recruiting <no-reply@greenhouse.io>", subject: "Thank you for applying to Acme", body: "" };
  assert.equal(names(resolveCompany(input)), "Acme");
  assert.equal(resolveCompany(input, { ...DEFAULT_RESOLVER_CONFIG, unknownBelow: 0.95 }).entity, null);
});
