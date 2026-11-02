import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { PipelineList } from "@/app/components/recruiting-views";
import { SyncControl } from "@/app/components/sync-control";
import { isDatabaseConfigured } from "@/lib/db";
import { toFloating } from "@/lib/recruiting/actions";
import { loadWorkspace } from "@/lib/recruiting/store";

export const metadata = { title: "Pipeline · Opportunity Inbox" };

export default async function PipelinePage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const real = new Date();
  const workspace = await loadWorkspace(sub, real);
  const active = workspace.opportunities.filter((o) => o.status === "active").length;
  const closed = workspace.opportunities.length - active;

  return (
    <AppShell active="pipeline" user={session?.user}>
      <h1 className="t-display">Pipeline</h1>
      <div className="t-meta mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-3">
        <span className="tnum">
          {active} active{closed > 0 ? `, ${closed} closed` : ""}
        </span>
        <SyncControl />
      </div>
      <div className="mt-14">
        <PipelineList opportunities={workspace.opportunities} now={toFloating(real)} basePath="/opportunities" />
      </div>
    </AppShell>
  );
}
