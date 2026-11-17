import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell, firstName } from "@/app/components/app-shell";
import { Greeting } from "@/app/components/greeting";
import { TodayComposition } from "@/app/components/recruiting-views";
import { isSyncLocked } from "@/app/sync-lock";
import { isDatabaseConfigured } from "@/lib/db";
import { embargoHidingMail, EMBARGO_CUTOFF } from "@/lib/gmail/embargo";
import { isSampleUser } from "@/lib/gmail/sample";
import { findGmailConnection } from "@/lib/gmail/credentials";
import { attentionCount, buildReviewQueue } from "@/lib/recruiting/review";
import { toFloating } from "@/lib/recruiting/actions";
import { buildBriefing } from "@/lib/recruiting/briefing";
import { loadWorkspace, recordUsage } from "@/lib/recruiting/store";

/** A read older than this is refreshed when the user opens Today (throttled in the browser). */
const STALE_AFTER_MS = 6 * 3_600_000;
const syncIsStale = (last: Date | null, now: Date) => last !== null && now.getTime() - last.getTime() > STALE_AFTER_MS;

export const metadata = { title: "Today · Opportunity Inbox" };

export default async function TodayPage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  if (!(await findGmailConnection(sub))) redirect("/");

  const real = new Date();
  const now = toFloating(real);
  const workspace = await loadWorkspace(sub, real);
  await recordUsage(sub, "view_today");
  const neverSynced = workspace.lastSyncedAt === null;
  const name = firstName(session?.user?.name, session?.user?.email);
  const needs = neverSynced ? null : buildBriefing(workspace.opportunities, workspace.actions, now).needsYou.length;
  const today = now.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const toCheck = neverSynced ? 0 : attentionCount(buildReviewQueue(workspace.opportunities, undefined, workspace.possible));
  const hiding = !isSampleUser(sub) && embargoHidingMail(real);

  return (
    <AppShell active="today" user={session?.user} updated={updated} autoSync={isSyncLocked() ? false : neverSynced ? "first" : syncIsStale(workspace.lastSyncedAt, real) ? "stale" : false} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="reading">
      <Greeting name={name} hour={real.getHours()} needsYou={needs}>
        <span>{today}</span>
      </Greeting>

      {hiding ? (
        <p className="t-meta mt-6 max-w-[60ch] rounded-md border border-line px-4 py-3 text-ink-2" role="status">
          Mail received on or after {EMBARGO_CUTOFF.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })} is not read or shown here while a separate evaluation of the reader is running. Earlier mail works as usual.
        </p>
      ) : null}
      {neverSynced ? (
        <div className="mt-12" role="status">
          <p className="t-lead max-w-[40ch] text-ink-2">
            The first read takes a minute or two. We look at each recruiting email once and keep only the company, stage and dates. The message text is never stored.
          </p>
          <div className="mt-10 space-y-3" aria-hidden>
            <span className="skeleton h-[7.5rem] w-full !rounded-[var(--r-lg)]" />
            <span className="skeleton h-4 w-3/4" />
            <span className="skeleton h-4 w-2/3" />
            <span className="skeleton h-4 w-1/2" />
          </div>
        </div>
      ) : workspace.opportunities.length === 0 ? (
        <div className="mt-12 max-w-[44ch]">
          <p className="t-heading">No recruiting emails found yet.</p>
          <p className="t-lead mt-2 text-ink-2">
            Applications, assessments, interviews and offers show up here as they arrive. If you were expecting some, they may be older than a year or filed under Promotions.
          </p>
        </div>
      ) : (
        <TodayComposition
          opportunities={workspace.opportunities}
          actions={workspace.actions}
          now={now}
          basePath="/opportunities"
          pipelineHref="/pipeline"
          editable
          greeting={null}
          toCheck={toCheck}
          updated={updated}
        />
      )}
    </AppShell>
  );
}
