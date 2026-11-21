import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { EventEditor } from "@/app/components/recruiting-views";
import { Triage } from "@/app/components/triage";
import { isDatabaseConfigured } from "@/lib/db";
import { toFloating } from "@/lib/recruiting/actions";
import { EVENT_NOUN, formatDay } from "@/lib/recruiting/format";
import { entityState } from "@/lib/recruiting/presentation";
import { buildReviewQueue } from "@/lib/recruiting/review";
import { reviewOptions } from "@/lib/recruiting/product-config";
import { loadWorkspace } from "@/lib/recruiting/store";
import { isSampleUser } from "@/lib/gmail/sample";

export const metadata = { title: "Needs review · Opportunity Inbox" };

export default async function ReviewPage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const real = new Date();
  const now = toFloating(real);
  const workspace = await loadWorkspace(sub, real);
  const queue = buildReviewQueue(workspace.opportunities, undefined, workspace.possible, now, reviewOptions());
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sample = isSampleUser(sub);

  const items = queue.map((item) => ({
    id: item.event.id,
    company: item.company,
    role: item.role,
    opportunityKey: item.opportunityKey,
    possible: Boolean(item.possible),
    weak: Boolean(item.weak),
    tier: item.tier,
    why: item.why,
    date: formatDay(item.event.occurredAt),
    sentence: item.possible
      ? "We think this might be about a job or internship."
      : item.why === "Might be a rejection"
        ? `We think this might be a rejection. We read it as ${EVENT_NOUN[item.event.type]}.`
        : item.event.type === "offer" && ((k) => k === "mentorship" || k === "scholarship")(workspace.opportunities.find((o) => o.key === item.opportunityKey)?.kind)
          ? "We think you were accepted into this program."
          : `We think this is ${EVENT_NOUN[item.event.type]}.`,
    entity: item.possible ? (item.event.company ? "likely" : "unknown") : (workspace.opportunities.find((o) => o.key === item.opportunityKey) ? entityState(workspace.opportunities.find((o) => o.key === item.opportunityKey)!) : "unknown"),
    reasons: item.reasons,
    source: `${item.event.senderName || item.event.senderDomain}: ${item.event.subject}`,
    gmailThread: sample ? null : item.event.gmailThreadId,
  }));
  const editors = Object.fromEntries(queue.map((item) => [item.event.id, <EventEditor key={item.event.id} event={item.event} compact />]));

  return (
    <AppShell active="review" user={session?.user} updated={updated} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="reading">
      <h1 className="t-display">Needs review</h1>
      <p className="t-lead mt-3 max-w-[46ch] text-ink-2">The things we are least sure about, the most important first. Each takes a few seconds.</p>
      <div className="mt-8">
        <Triage items={items} editors={editors} />
      </div>
    </AppShell>
  );
}
