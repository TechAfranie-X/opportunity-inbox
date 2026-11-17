import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { EventEditor } from "@/app/components/recruiting-views";
import { Triage } from "@/app/components/triage";
import { isDatabaseConfigured } from "@/lib/db";
import { toFloating } from "@/lib/recruiting/actions";
import { EVENT_LABEL, formatDay, gmailThreadUrl } from "@/lib/recruiting/format";
import { buildReviewQueue } from "@/lib/recruiting/review";
import { loadWorkspace } from "@/lib/recruiting/store";
import { isSampleUser } from "@/lib/gmail/sample";

export const metadata = { title: "Check · Opportunity Inbox" };

export default async function ReviewPage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const real = new Date();
  const now = toFloating(real);
  const workspace = await loadWorkspace(sub, real);
  const queue = buildReviewQueue(workspace.opportunities, undefined, workspace.possible, now);
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
    sentence: item.possible ? "Might this be about a job or internship?" : `We read this as ${EVENT_LABEL[item.event.type].toLowerCase()}.`,
    reasons: item.reasons,
    source: `${item.event.senderName || item.event.senderDomain}: ${item.event.subject}`,
    gmailHref: sample ? null : gmailThreadUrl(item.event.gmailThreadId),
  }));
  const editors = Object.fromEntries(queue.map((item) => [item.event.id, <EventEditor key={item.event.id} event={item.event} compact />]));

  return (
    <AppShell active="review" user={session?.user} updated={updated} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="reading">
      <h1 className="t-display">Check</h1>
      <p className="t-lead mt-3 max-w-[46ch] text-ink-2">The things we are least sure about, most important first. Each takes a few seconds.</p>
      <div className="mt-8">
        <Triage items={items} editors={editors} />
      </div>
    </AppShell>
  );
}
