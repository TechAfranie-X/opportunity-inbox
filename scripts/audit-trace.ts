// Read-only: prints, for one stored account, the opportunities whose company matches a pattern, with every event's date, type, role, thread and identity signals. Metadata only
// (no message text is stored or printed). Usage: audit-trace.ts <googleSub> <company-regex>
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
const re = new RegExp(process.argv[3], "i");
for (const o of ws.opportunities.filter((x) => re.test(x.company))) {
  console.log(`## ${o.company} | ${o.role ?? "-"} | ${o.status}/${o.stage}${o.closedBy ? "/" + o.closedBy : ""} outcome=${o.outcome} kind=${o.kind} key=${o.key} contradictions=${(o.contradictions ?? []).map((c) => c.kind).join(",")}`);
  for (const e of o.events) console.log(`   ${e.occurredAt.toISOString().slice(0, 10)} ${e.type.padEnd(19)} ${(e.role ?? "-").slice(0, 28).padEnd(28)} t=${e.gmailThreadId.slice(0, 6)} ${e.outbound ? "OUT" : "   "} d=${e.eventDate ? e.eventDate.toISOString().slice(5, 10) : "-"} ${e.signals.filter((s) => /^(unit:|role-inherited|reply-in|known-contact|identity:|employer:|semantic:type|semantic:event|retraction|calendar|offer expired|student:)/.test(s)).join(",").slice(0, 80)} | ${e.subject.slice(0, 44)}`);
}
for (const p of ws.possible.filter((x) => re.test(x.company ?? ""))) console.log(`   POSSIBLE ${p.occurredAt.toISOString().slice(0, 10)} ${p.type} | ${p.subject.slice(0, 50)}`);
process.exit(0);
