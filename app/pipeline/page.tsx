import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { PipelineExplorer } from "@/app/components/pipeline-explorer";
import { isDatabaseConfigured } from "@/lib/db";
import { toFloating } from "@/lib/recruiting/actions";
import { loadWorkspace } from "@/lib/recruiting/store";

export const metadata = { title: "Pipeline · Opportunity Inbox" };

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const real = new Date();
  const now = toFloating(real);
  const workspace = await loadWorkspace(sub, real);
  const params = await searchParams;
  const stage = typeof params.stage === "string" ? params.stage : undefined;
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <AppShell active="pipeline" user={session?.user} updated={updated} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="mid">
      <h1 className="t-display">Pipeline</h1>
      <p className="t-lead tnum mt-3 text-ink-2">
        {workspace.opportunities.filter((o) => o.status === "active").length} active
        {workspace.opportunities.some((o) => o.status === "closed") ? `, ${workspace.opportunities.filter((o) => o.status === "closed").length} closed` : ""}
      </p>
      <div className="mt-10">
        <PipelineExplorer initialStage={stage} />
      </div>
    </AppShell>
  );
}
