import assert from "node:assert/strict";
import type { Observed } from "./harness.ts";
import type { Facet, LifecycleCase } from "./dev/cases.ts";

/** Evaluates one expectation (facet) against what the product produced. Shared by the development and held-out sets. */
export function check(c: LifecycleCase, o: Observed, f: Facet): void {
  const g = (id: string) => o.groups[o.groupOf(id)];
  switch (f.kind) {
    case "mustLink": assert.equal(o.groupOf(f.a), o.groupOf(f.b), `${f.a} and ${f.b} should be one opportunity`); return;
    case "cannotLink": assert.notEqual(o.groupOf(f.a), o.groupOf(f.b), `${f.a} and ${f.b} are merged into one opportunity (${g(f.a)?.role ?? "?"})`); return;
    case "role": {
      const role = g(f.of)?.role ?? "";
      if (f.includes) assert.ok(role.includes(f.includes), `role is "${role}", expected it to include "${f.includes}"`);
      if (f.excludes) assert.ok(!role.includes(f.excludes), `role is "${role}", it must not include "${f.excludes}"`);
      return;
    }
    case "stage": assert.equal(g(f.of)?.stage, f.is); return;
    case "active": assert.equal(o.active(f.of), f.is, `opportunity is ${g(f.of)?.status} at stage ${g(f.of)?.stage}`); return;
    case "outcome": assert.equal(g(f.of)?.outcome, f.is); return;
    case "action": assert.equal(o.actions.some((a) => a.kind === f.actionKind && a.ids.includes(f.of)), f.present, `actions for this opportunity: ${o.actions.filter((a) => a.ids.includes(f.of)).map((a) => a.kind).join(", ") || "none"}`); return;
    case "noNeedsYou": assert.deepEqual(o.actions.filter((a) => a.ids.includes(f.of) && a.bucket !== "worth_a_look").map((a) => `${a.kind}:${a.bucket}`), []); return;
    case "contradictionFlagged": assert.ok(!o.active(f.of) || o.reviewImportant > 0, `still ${g(f.of)?.status} (${g(f.of)?.stage}) with ${o.reviewImportant} important review items: the product says nothing is wrong`); return;
    case "uniqueEvents": { const all = o.groups.flatMap((x) => x.ids); assert.equal(new Set(all).size, all.length, "an event appears twice"); return; }
    case "keepsCorrection": assert.equal(g(f.of)?.opportunity.events.find((e) => e.id === f.of)?.corrected, true); return;
  }
}

