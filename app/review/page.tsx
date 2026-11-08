import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { EventEditor } from "@/app/components/recruiting-views";
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
  const queue = buildReviewQueue(workspace.opportunities);
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sample = isSampleUser(sub);

  return (
    <AppShell active="review" user={session?.user} updated={updated} opportunities={workspace.opportunities} now={now}>
      <h1 className="t-display">Check these</h1>
      <p className="t-lead mt-3 max-w-[46ch] text-ink-2">
        {queue.length === 0
          ? "Nothing to check. Everything we read looked clear, or you have already settled it."
          : "We are not sure about these. Confirm what is right, fix what is wrong, or hide what is not recruiting. It takes a few seconds each, and it keeps your history clean."}
      </p>
      <ul className="mt-10 divide-y divide-line border-y border-line">
        {queue.map((item) => (
          <li key={item.event.id} className="py-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="font-medium tracking-tight">
                <Link className="underline decoration-line underline-offset-2 hover:decoration-ink" href={`/opportunities/${encodeURIComponent(item.opportunityKey)}`}>
                  {item.company}
                </Link>
                {item.role ? <span className="ml-2 font-normal text-ink-2">{item.role}</span> : null}
              </p>
              <p className="t-meta tnum text-ink-3">{formatDay(item.event.occurredAt)}</p>
            </div>
            <p className="mt-1">
              We read this as <strong className="font-medium">{EVENT_LABEL[item.event.type].toLowerCase()}</strong>.
            </p>
            <ul className="t-meta mt-1 list-disc pl-5 text-ink-3">
              {item.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="t-meta mt-1 truncate text-ink-3">{item.event.senderName || item.event.senderDomain}: {item.event.subject}</p>
            {sample ? null : (
              <p className="mt-1">
                <a className="link-quiet t-meta" href={gmailThreadUrl(item.event.gmailThreadId)} target="_blank" rel="noreferrer">
                  Open the email in Gmail
                </a>
              </p>
            )}
            <EventEditor event={item.event} />
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
