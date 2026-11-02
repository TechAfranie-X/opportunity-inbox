import assert from "node:assert/strict";
import test from "node:test";
import { draftsFromConfirmation, draftsFromEdit, draftsFromIgnore, draftsFromLegacyCorrection, draftsFromReset, encodeField, type FieldValues } from "./corrections.ts";

const predicted: FieldValues = { type: "assessment", company: "Greenhouse", role: null, eventDate: new Date("2026-03-05T00:00:00Z") };
const fields = (d: Array<{ field: string }>) => d.map((x) => x.field).sort();

test("only fields the person actually changed become labels; untouched fields are not assumed correct", () => {
  const d = draftsFromEdit(predicted, { ...predicted, company: "Acme" }, {});
  assert.deepEqual(d, [{ field: "company", value: "Acme", kind: "correction" }]);
  assert.deepEqual(draftsFromEdit(predicted, predicted, {}), []); // saving without changes says nothing
});

test("several changes produce one label each, with role cleared recorded as not_applicable", () => {
  const d = draftsFromEdit(predicted, { type: "interview_scheduled", company: "Acme", role: "SWE Intern", eventDate: null }, {});
  assert.deepEqual(fields(d), ["company", "event_date", "role", "type"]);
  assert.equal(d.find((x) => x.field === "event_date")?.value, "not_applicable");
  assert.equal(d.find((x) => x.field === "role")?.value, "SWE Intern");
  const cleared = draftsFromEdit({ ...predicted, role: "Analyst" }, { ...predicted, role: null }, {});
  assert.equal(cleared[0].value, "not_applicable");
});

test("changing their mind back to the prediction is recorded as a revert, not lost", () => {
  const prior = { company: "Acme" };
  const d = draftsFromEdit(predicted, predicted, prior);
  assert.deepEqual(d, [{ field: "company", value: "Greenhouse", kind: "revert" }]);
});

test("repeating a correction already on record adds nothing; the log never repeats itself", () => {
  assert.equal(draftsFromEdit(predicted, { ...predicted, company: "Acme" }, { company: "Acme" }).length, 0);
});

test("ignore asserts not-recruiting once", () => {
  assert.deepEqual(draftsFromIgnore({}), [{ field: "is_recruiting", value: false, kind: "correction" }]);
  assert.deepEqual(draftsFromIgnore({ is_recruiting: false }), []);
});

test("confirmation labels what is shown, only where not already stated", () => {
  const d = draftsFromConfirmation({ type: "applied", company: "Acme", role: "SWE Intern", eventDate: null }, {});
  assert.deepEqual(fields(d), ["company", "event_date", "is_recruiting", "role", "type"]);
  assert.ok(d.every((x) => x.kind === "confirmation"));
  assert.deepEqual(draftsFromConfirmation({ type: "applied", company: "Acme", role: null, eventDate: null }, { is_recruiting: true, type: "applied", company: "Acme", role: "not_applicable", event_date: "not_applicable" }), []);
});

test("reset returns every changed field to the prediction and re-asserts recruiting after an ignore", () => {
  const d = draftsFromReset(predicted, { company: "Acme", is_recruiting: false, type: "assessment" });
  assert.deepEqual(fields(d), ["company", "is_recruiting"]);
  assert.equal(d.find((x) => x.field === "company")?.value, "Greenhouse");
  assert.equal(d.find((x) => x.field === "is_recruiting")?.value, true);
});

test("legacy corrections map to labels field by field", () => {
  assert.deepEqual(draftsFromLegacyCorrection({ ignored: true }), [{ field: "is_recruiting", value: false, kind: "correction" }]);
  const d = draftsFromLegacyCorrection({ type: "offer", company: "Acme", role: null, eventDate: new Date("2026-04-01T00:00:00Z") });
  assert.deepEqual(d.map((x) => [x.field, x.value]).sort(), [["company", "Acme"], ["event_date", "2026-04-01T00:00:00.000Z"], ["role", "not_applicable"], ["type", "offer"]]);
  assert.deepEqual(draftsFromLegacyCorrection({}), []);
});

test("encoding is stable", () => {
  assert.equal(encodeField("company", { ...predicted, company: null }), "unknown");
  assert.equal(encodeField("role", predicted), "not_applicable");
  assert.equal(encodeField("type", predicted), "assessment");
});
