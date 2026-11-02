import assert from "node:assert/strict";
import test from "node:test";
import { computeValidationMetrics } from "./metrics.ts";

test("computes per-tester correction rate and return days", () => {
  const t0 = new Date("2026-10-01T12:00:00Z");
  const rows = computeValidationMetrics({
    connections: [{ user: "a", connectedAt: t0 }, { user: "b", connectedAt: new Date("2026-10-02T12:00:00Z") }],
    syncs: [{ userGoogleSub: "a", lastSyncedAt: t0, messagesScanned: 120, eventsExtracted: 4 }],
    events: [
      { user: "a", correction: { type: "rejection" } },
      { user: "a", correction: null },
      { user: "a", correction: { company: "Stripe", role: "SWE" } },
      { user: "a", correction: { ignored: true } },
    ],
    usage: [
      { user: "a", kind: "view_today", at: new Date("2026-10-01T13:00:00Z") },
      { user: "a", kind: "view_today", at: new Date("2026-10-03T09:00:00Z") },
      { user: "a", kind: "view_today", at: new Date("2026-10-03T18:00:00Z") },
      { user: "a", kind: "dismiss_action", at: new Date("2026-10-03T18:05:00Z") },
    ],
  });
  assert.equal(rows.length, 2);
  const a = rows[0];
  assert.equal(a.label, "Tester 1");
  assert.equal(a.eventsCorrected, 3);
  assert.equal(a.correctionRate, 0.75);
  assert.deepEqual(a.correctionsByField, { type: 1, company: 1, role: 1, ignored: 1 });
  assert.equal(a.todayViews, 3);
  assert.equal(a.activeDays, 2);
  assert.equal(a.returnDays, 1);
  assert.equal(a.actionsDismissed, 1);
  assert.equal(rows[1].eventsExtracted, 0);
});
