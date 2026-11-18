// Read-only: which stored events the refinement layer excludes, with reason (subject shown only for audit on this machine).
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { recruitingEvents } from "../lib/db/schema.ts";
import { exclusionReason } from "../lib/lifecycle/refine.ts";
const rows = await getDb().select().from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, process.argv[2]));
for (const r of rows) { const why = exclusionReason({ subject: r.subject, senderName: r.senderName, senderDomain: r.senderDomain, company: r.company }); if (why) console.log(`${why.padEnd(16)} ${r.type.padEnd(18)} ${(r.company ?? "-").slice(0, 22).padEnd(22)} ${r.subject.slice(0, 60)}`); }
process.exit(0);
