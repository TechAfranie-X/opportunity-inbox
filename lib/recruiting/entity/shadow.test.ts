import assert from "node:assert/strict";
import test from "node:test";
import { applyResolutions, formatShadowComparison } from "./shadow.ts";
import { evaluate, type LabelRow } from "../evaluator.ts";
import { resolveCompany } from "./resolve.ts";
import type { Prediction } from "../predictions.ts";

const base = (id: string, o: Partial<Prediction>): Prediction => ({ gmailMessageId: id, gmailThreadId: `t${id}`, extractorVersion: "v", decision: "recruiting", outbound: false, senderDomain: "", type: "applied", company: null, role: null, eventDate: null, dateKind: null, confidence: 0.9, fieldConfidence: null, signals: [], reviewReasons: [], ...o });
const lab = (id: string, field: string, value: unknown): LabelRow => ({ gmailMessageId: id, field: field as never, value, source: "dev_human", createdAt: new Date("2026-01-01") });

test("shadow replaces only the company of recruiting predictions and carries the resolver's confidence", () => {
  const preds = [base("1", { company: "Greenhouse" }), base("2", { decision: "not_recruiting", company: null, confidence: null })];
  const res = new Map([["1", resolveCompany({ from: "Acme <jobs@acme.com>", subject: "Thank you for applying to Acme", body: "" })], ["2", resolveCompany({ from: "x@y.com", subject: "", body: "" })]]);
  const out = applyResolutions(preds, res);
  assert.equal(out[0].company, "Acme");
  assert.ok((out[0].fieldConfidence?.company ?? 0) > 0.8);
  assert.equal(out[0].type, "applied");
  assert.deepEqual(out[1], preds[1]); // not-recruiting predictions are untouched
});

test("comparison reports the company metrics side by side, including confident-wrong", () => {
  const ids = ["1", "2"];
  const labels = ids.flatMap((id) => [lab(id, "is_recruiting", true), lab(id, "type", "applied"), lab(id, "company", "Acme")]);
  const mk = (company: string | null, conf: number) => evaluate({
    kind: "dev_random", datasetName: "d", asOf: new Date("2026-01-01"), messageIds: ids, threadOf: new Map(ids.map((i) => [i, `t${i}`])), labels,
    predictions: ids.map((id) => base(id, { company, fieldConfidence: { company: conf } })), predictedGroups: new Map(), predictedTodayThreads: new Set(),
  });
  const text = formatShadowComparison(mk("Greenhouse", 0.9), mk("Acme", 0.9));
  assert.match(text, /^SHADOW COMPARISON/);
  assert.match(text, /exact match\s+current 0\.0%.*resolver 100\.0%/);
  assert.match(text, /confident-wrong\s+current 100\.0%.*resolver 0\.0%/);
});
