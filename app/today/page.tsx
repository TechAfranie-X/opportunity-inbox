import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { SyncButton } from "@/app/components/sync-button";
import { TodayView } from "@/app/components/recruiting-views";
import { isDatabaseConfigured } from "@/lib/db";
import { findGmailConnection } from "@/lib/gmail/credentials";
import { loadWorkspace, recordUsage } from "@/lib/recruiting/store";

export const metadata = { title: "Today · Opportunity Inbox" };

function lastSyncedLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function TodayPage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  if (!(await findGmailConnection(sub))) redirect("/");

  const workspace = await loadWorkspace(sub);
  await recordUsage(sub, "view_today");
  const neverSynced = workspace.lastSyncedAt === null;

  return (
    <AppShell active="today" userLabel={session?.user?.email ?? undefined}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {neverSynced
              ? "Reading your inbox for recruiting activity…"
              : `${workspace.opportunities.filter((o) => o.status === "active").length} active opportunities · updated ${lastSyncedLabel(workspace.lastSyncedAt!)}`}
          </p>
        </div>
        <SyncButton autoStart={neverSynced} label={neverSynced ? "Scan my inbox" : "Refresh from Gmail"} />
      </div>

      <div className="mt-8">
        {neverSynced ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            This takes about a minute the first time. We read each recruiting email once, keep only the company, stage and dates, and never store the message text.
          </p>
        ) : workspace.opportunities.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            We didn&apos;t find recruiting emails in the last year. If that&apos;s wrong, tell us — it&apos;s exactly the kind of miss we want to fix.
          </p>
        ) : (
          <TodayView actions={workspace.actions} basePath="/opportunities" editable />
        )}
      </div>
    </AppShell>
  );
}
