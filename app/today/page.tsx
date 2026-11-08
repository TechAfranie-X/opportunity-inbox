import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell, firstName } from "@/app/components/app-shell";
import { Greeting } from "@/app/components/greeting";
import { TodayComposition } from "@/app/components/recruiting-views";
import { isSyncLocked } from "@/app/sync-lock";
import { isDatabaseConfigured } from "@/lib/db";
import { findGmailConnection } from "@/lib/gmail/credentials";
import { toFloating } from "@/lib/recruiting/actions";
import { buildBriefing } from "@/lib/recruiting/briefing";
import { loadWorkspace, recordUsage } from "@/lib/recruiting/store";

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

  return (
    <AppShell active="today" user={session?.user} updated={updated} autoSync={neverSynced && !isSyncLocked()}opportunities={workspace.opportunities} now={now}>
      <Greeting name={name} hour={real.getHours()} needsYou={needs}>
        <span>{today}</span>
      </Greeting>

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
