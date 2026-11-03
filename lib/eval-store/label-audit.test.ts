import assert from "node:assert/strict";
import test from "node:test";
import { flagLabels, latestLabels, summarize } from "./label-audit.ts";

const T = (n: number) => new Date(2026, 0, 1, 0, n);
const row = (id: string, field: string, value: unknown, n = 0) => ({ gmailMessageId: id, field, value, createdAt: T(n) });

test("the newest label wins, so a superseding row changes what the audit sees", () => {
  const l = latestLabels([row("a", "type", "offer", 1), row("a", "type", "rejection", 2), row("a", "is_recruiting", true)]);
  assert.equal(l.get("a")!.type, "rejection");
});

test("the audit flags doubt and contradictions using labels alone", () => {
  const labels = latestLabels([
    row("a", "is_recruiting", true), row("a", "type", "rejection"), row("a", "stage", "offer"), row("a", "company", "unknown"),
    row("b", "is_recruiting", false), row("b", "type", "applied"),
    row("c", "is_recruiting", true), row("c", "type", "interview_scheduled"), row("c", "stage", "interview"), row("c", "event_date", "not_applicable"),
    row("d", "is_recruiting", true), row("d", "type", "applied"), row("d", "stage", "applied"), row("d", "company", "Acme"), row("d", "opportunity_ref", "x"),
    row("e", "is_recruiting", true), row("e", "type", "applied"), row("e", "stage", "applied"), row("e", "company", "Globex"), row("e", "opportunity_ref", "x"),
  ]);
  const by = new Map(flagLabels(labels).map((f) => [f.id, f.reasons.join("|")]));
  assert.match(by.get("a")!, /company: cannot tell/);
  assert.match(by.get("a")!, /type rejection but stage offer/);
  assert.match(by.get("b")!, /type: set on a non-recruiting message/);
  assert.match(by.get("c")!, /scheduled interview without a date/);
  assert.match(by.get("d")!, /one opportunity id used for different companies/);
});

test("the summary counts what a labeler said and nothing else", () => {
  const labels = latestLabels([
    row("a", "is_recruiting", true), row("a", "type", "applied"), row("a", "company", "Acme"), row("a", "role", "not_applicable"), row("a", "opportunity_ref", "o1"), row("a", "stage", "applied"), row("a", "actionable", false), row("a", "urgency", "none"), row("a", "event_date", "not_applicable"),
    row("b", "is_recruiting", false),
  ]);
  const s = summarize(labels, ["a", "b", "c"]);
  assert.deepEqual([s.totalLabeled, s.yes, s.no, s.unlabeledMembers, s.distinctOpportunities], [2, 1, 1, 1, 1]);
  assert.deepEqual([s.role.notApplicable, s.company.known], [1, 1]);
});
