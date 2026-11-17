import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { EventEditor } from "@/app/components/recruiting-views";
import { Disclose } from "@/app/components/disclose";
import { ReviewTools } from "@/app/components/review-tools";
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
  const queue = buildReviewQueue(workspace.opportunities, undefined, workspace.possible);
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sample = isSampleUser(sub);

  const counted = queue.filter((i) => !i.weak);
  const folded = queue.filter((i) => i.weak);
  const renderItem = (item: (typeof queue)[number]) => (
    <li key={item.event.id} className="review-item py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="font-medium tracking-tight">
          {item.possible ? (
            item.company
          ) : (
            <Link className="link" href={`/opportunities/${encodeURIComponent(item.opportunityKey)}`}>
              {item.company}
            </Link>
          )}
          {item.role ? <span className="ml-2 font-normal text-ink-2">{item.role}</span> : null}
        </p>
        <p className="t-meta tnum text-ink-3">{formatDay(item.event.occurredAt)}</p>
      </div>
      {item.possible ? (
        <p className="mt-1">Might this be about a job or internship?</p>
      ) : (
        <p className="mt-1">
          We read this as <strong className="font-medium">{EVENT_LABEL[item.event.type].toLowerCase()}</strong>.
        </p>
      )}
      <p className="t-meta mt-1 text-ink-2">{item.reasons.join(" ")}</p>
      <p className="t-meta mt-1 flex items-baseline gap-x-4 text-ink-3">
        <span className="min-w-0 truncate">
          {item.event.senderName || item.event.senderDomain}: {item.event.subject}
        </span>
        {sample ? null : (
          <a className="link-quiet t-meta shrink-0" href={gmailThreadUrl(item.event.gmailThreadId)} target="_blank" rel="noreferrer">
            Open in Gmail
          </a>
        )}
      </p>
      <ReviewTools eventId={item.event.id} confirmLabel={item.possible ? "Yes, it is recruiting" : "Looks right"}>
        <EventEditor event={item.event} compact />
      </ReviewTools>
    </li>
  );

  return (
    <AppShell active="review" user={session?.user} updated={updated} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="reading">
      <h1 className="t-display flex items-center gap-3">
        Check these
        {counted.length > 0 ? <span className="badge" aria-label={`${counted.length} to check`}>{counted.length}</span> : null}
      </h1>
      <p className="t-lead mt-3 max-w-[46ch] text-ink-2">
        {counted.length === 0
          ? "Nothing to check. Everything we read looked clear, or you have already settled it."
          : "We are not sure about these. It takes a few seconds each, and it keeps your history clean."}
      </p>
      {counted.length > 0 ? <ul className="mt-10 divide-y divide-line border-y border-line">{counted.map((item) => renderItem(item))}</ul> : null}
      {folded.length > 0 ? (
        <Disclose className="mt-10" summary={`Also possibly recruiting · ${folded.length}`} openSummary="Hide these">
          <p className="t-meta mb-2 mt-3 max-w-[52ch] text-ink-3">Mail that looks a little like hiring but that we are less sure about. None of it is in your pipeline.</p>
          <ul className="divide-y divide-line border-y border-line">{folded.map((item) => renderItem(item))}</ul>
        </Disclose>
      ) : null}
    </AppShell>
  );
}
