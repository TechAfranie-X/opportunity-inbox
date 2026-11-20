/**
 * Re-reads one account's mail with the CURRENT reader (the product's "already evaluated" memory is keyed by the reader version, so after a version bump every message is read
 * again, incrementally, keeping every correction and never deleting a prediction). Gmail is read-only; the language model, when enabled in .env.local, is the LOCAL one.
 *   node --env-file=.env.local --no-warnings --import ./scripts/loader/register.mjs scripts/resync.ts <google-sub> [--passes 12]
 */
import { syncRecruitingMail } from "../lib/recruiting/sync.ts";
const sub = process.argv[2];
const passes = Number(process.argv[process.argv.indexOf("--passes") + 1]) || 12;
for (let i = 1; i <= passes; i++) {
  const r = await syncRecruitingMail(sub);
  console.log(`pass ${i}:`, JSON.stringify(r).slice(0, 300));
  if (!r.ok || r.remaining === 0) break;
}
process.exit(0);
