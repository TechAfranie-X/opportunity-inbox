import assert from "node:assert/strict";
import test from "node:test";

// reassess.ts imports the database layer through "@/..." aliases; the selection rule is pure, so it is exercised through a dynamic import guarded by the loader.
test("a backfill never selects a row a person confirmed, corrected or ignored, nor one already refreshed in this generation; running it twice selects nothing new", async () => {
  const { selectBackfillCandidates, BACKFILL_MARK } = await import("./reassess.ts");
  const row = (id: string, signals: string[] = []) => ({ gmailMessageId: id, signals });
  const rows = [row("a"), row("b"), row("c"), row("d", [BACKFILL_MARK]), row("e", ["identity:backfilled:2"])];
  const corrected = new Set(["b", "c"]); // confirmed / edited / ignored: their correction column is non-null
  const first = selectBackfillCandidates(rows, corrected).map((r) => r.gmailMessageId);
  assert.deepEqual(first, ["a", "e"], "an older generation's mark does not protect a row; a person's correction always does");
  const after = rows.map((r) => (first.includes(r.gmailMessageId) ? { ...r, signals: [...r.signals, BACKFILL_MARK] } : r));
  assert.deepEqual(selectBackfillCandidates(after, corrected), [], "idempotent: the second run has nothing to do");
});
