import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { esc, formToLabels, renderPage } from "./label-page.ts";
import type { RecruitingEmail } from "../recruiting/types.ts";

const msg = (o: Partial<RecruitingEmail> = {}): RecruitingEmail => ({ id: "m1", threadId: "t1", from: "Acme <jobs@acme.com>", subject: "Hello", receivedAt: new Date("2026-03-01T10:00:00Z"), outbound: false, bodyText: "Please complete the assessment.", ...o });
const page = (m = msg(), existing = {}) => renderPage({ token: "tok", index: 0, total: 3, labeled: 1, dataset: "dev-random-1", kind: "dev_random", asOf: "2026-03-01T09:00:00.000Z", message: m, thread: [], existing, refs: ["acme-swe"] });
const form = (o: Record<string, string>) => new URLSearchParams(o);
const ctx = { kind: "dev_random" as const, messageId: "m1", labeler: "me" };

test("hostile email text is escaped, never executed", () => {
  const html = page(msg({ subject: '<script>alert(1)</script>', bodyText: '"><img src=x onerror=alert(1)>', from: "<b>x</b>" }));
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("the page shows the message and prior human labels, and says no predictions are loaded", () => {
  const html = page(msg(), { is_recruiting: true, company: "Acme", type: "assessment", urgency: "today" });
  assert.ok(html.includes("Please complete the assessment."));
  assert.match(html, /name="recruiting" value="yes" checked/);
  assert.match(html, /No predictions are loaded/);
  assert.ok(html.includes('value="Acme"'));
});

test("a complete recruiting form becomes validated, dataset-sourced label rows", () => {
  const r = formToLabels(form({ recruiting: "yes", type: "assessment", company: "Acme", role_mode: "value", role: "SWE Intern", opportunity_ref: "acme-swe", stage: "assessment", date_mode: "value", event_date: "2026-03-05", actionable: "yes", urgency: "today" }), ctx);
  assert.ok("rows" in r);
  if (!("rows" in r)) return;
  assert.deepEqual(r.rows.map((x) => x.field).sort(), ["actionable", "company", "event_date", "is_recruiting", "opportunity_ref", "role", "stage", "type", "urgency"]);
  assert.ok(r.rows.every((x) => x.source === "dev_human" && x.labeler === "me"));
});

test("'not recruiting' needs only that one answer", () => {
  const r = formToLabels(form({ recruiting: "no" }), ctx);
  assert.ok("rows" in r && r.rows.length === 1 && r.rows[0].field === "is_recruiting" && r.rows[0].value === false);
});

test("explicit unknown / not-applicable choices are recorded, not left blank", () => {
  const r = formToLabels(form({ recruiting: "yes", type: "unknown", company_unknown: "1", role_mode: "na", opportunity_ref: "x", date_mode: "unknown", actionable: "no", urgency: "none" }), ctx);
  assert.ok("rows" in r);
  if (!("rows" in r)) return;
  const by = Object.fromEntries(r.rows.map((x) => [x.field, x.value]));
  assert.deepEqual([by.type, by.company, by.role, by.event_date], ["unknown", "unknown", "not_applicable", "unknown"]);
});

test("an incomplete form is refused with a reason, so half-labeled messages never enter ground truth", () => {
  const base = { recruiting: "yes", type: "assessment", company: "Acme", role_mode: "na", opportunity_ref: "x", date_mode: "na", actionable: "no", urgency: "none" };
  assert.match((formToLabels(form({}), ctx) as { error: string }).error, /recruiting activity/);
  for (const missing of ["type", "company", "role_mode", "opportunity_ref", "date_mode", "actionable", "urgency"]) {
    const f = { ...base } as Record<string, string>;
    delete f[missing];
    assert.ok("error" in formToLabels(form(f), ctx), `missing ${missing} should be refused`);
  }
  assert.ok("error" in formToLabels(form({ ...base, type: "not-a-type" }), ctx));
  assert.ok("error" in formToLabels(form({ ...base, date_mode: "value", event_date: "" }), ctx));
});

test("skip stores nothing", () => {
  assert.deepEqual(formToLabels(form({ skip: "1" }), ctx), { skip: true });
});

test("a BLIND dataset's labels are tagged blind_human", () => {
  const r = formToLabels(form({ recruiting: "no" }), { ...ctx, kind: "blind" });
  assert.ok("rows" in r && r.rows[0].source === "blind_human");
});

// The anchoring guarantee: the labeling tool must be structurally unable to see predictions.
test("the labeling tool cannot read predictions: no extractor, prediction, evaluator or product imports", () => {
  const sources = ["scripts/label-server.ts", "lib/eval-store/label-page.ts", "lib/eval-store/labels-io.ts"].map((p) => [p, readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")] as const);
  const forbiddenImports = /from\s+"[^"]*\/(extract|predictions|company|opportunity|product|actions|briefing|history|store|sync|dates|eval|metrics)(\.ts)?"/;
  // evaluator.ts is allowed ONLY for resolveLabels/LabelRow (label arithmetic); it must not be used to score here
  const forbiddenTables = /\b(eventPredictions|recruitingEvents|evalRuns)\b/;
  for (const [path, src] of sources) {
    const imports = src.split("\n").filter((l) => /^import /.test(l));
    for (const line of imports) assert.ok(!forbiddenImports.test(line), `${path} imports a prediction-bearing module: ${line}`);
    assert.ok(!forbiddenTables.test(src), `${path} references a prediction-bearing table`);
    assert.ok(!/\bevaluate\s*\(/.test(src), `${path} must not run the evaluator`);
    assert.ok(!/\bbuildPredictions|extractAll|extractEvent|extractWithReason\b/.test(src), `${path} must not run the extractor`);
  }
});
