import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { ActivityStream } from "@/app/components/recruiting-views";
import { isDatabaseConfigured } from "@/lib/db";
import { toFloating } from "@/lib/recruiting/actions";
import { loadWorkspace } from "@/lib/recruiting/store";

export const metadata = { title: "Activity · Opportunity Inbox" };

export default async function ActivityPage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const real = new Date();
  const now = toFloating(real);
  const workspace = await loadWorkspace(sub, real);
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <AppShell active="activity" user={session?.user} updated={updated} opportunities={workspace.opportunities} now={now}>
      <h1 className="t-display">Activity</h1>
      <p className="t-lead mt-3 max-w-[44ch] text-ink-2">Everything that moved in your recruiting, newest first.</p>
      <div className="mt-10">
        <ActivityStream opportunities={workspace.opportunities} now={now} />
      </div>
    </AppShell>
  );
}
