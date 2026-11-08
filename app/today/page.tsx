import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell, firstName } from "@/app/components/app-shell";
import { Greeting } from "@/app/components/greeting";
import { TodayComposition } from "@/app/components/recruiting-views";
import { isSyncLocked } from "@/app/sync-lock";
import { isDatabaseConfigured } from "@/lib/db";
import Link from "next/link";
import { embargoHidingMail, EMBARGO_CUTOFF } from "@/lib/gmail/embargo";
import { isSampleUser } from "@/lib/gmail/sample";
import { findGmailConnection } from "@/lib/gmail/credentials";
import { buildReviewQueue } from "@/lib/recruiting/review";
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

  const toCheck = neverSynced ? 0 : buildReviewQueue(workspace.opportunities).length;
  const hiding = !isSampleUser(sub) && embargoHidingMail(real);

  return (
    <AppShell active="today" user={session?.user} updated={updated} autoSync={isSyncLocked() ? false : neverSynced ? "first" : syncIsStale(workspace.lastSyncedAt, real) ? "stale" : false}opportunities={workspace.opportunities} now={now}>
      <Greeting name={name} hour={real.getHours()} needsYou={needs}>
        <span>{today}</span>
      </Greeting>

      {hiding ? (
        <p className="t-meta mt-6 max-w-[60ch] rounded-md border border-line px-4 py-3 text-ink-2" role="status">
          Mail received on or after {EMBARGO_CUTOFF.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })} is not read or shown here while a separate evaluation of the reader is running. Earlier mail works as usual.
        </p>
      ) : null}
      {toCheck > 0 ? (
        <p className="mt-6 max-w-[60ch]">
          <Link href="/review" className="underline decoration-line underline-offset-2 hover:decoration-ink">
            {toCheck} {toCheck === 1 ? "thing is" : "things are"} worth a quick check
          </Link>
          <span className="text-ink-3"> so your history stays accurate.</span>
        </p>
      ) : null}
      {neverSynced ? (
        <p className="t-lead mt-12 max-w-[40ch] text-ink-2">
          The first read takes a minute or two. We look at each recruiting email once and keep only the company, stage and dates. The message text is never stored.
        </p>
      ) : workspace.opportunities.length === 0 ? (
        <p className="t-lead mt-12 max-w-[40ch] text-ink-2">
          We didn&apos;t find recruiting emails in your inbox. If you were expecting some, tell us which ones we missed.
        </p>
      ) : (
        <TodayComposition
          opportunities={workspace.opportunities}
          actions={workspace.actions}
          now={now}
          basePath="/opportunities"
          pipelineHref="/pipeline"
          editable
          greeting={null}
        />
      )}
    </AppShell>
  );
}
