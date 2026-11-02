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
    <AppShell active="pipeline" user={session?.user} updated={updated} opportunities={workspace.opportunities} now={now}>
      <h1 className="t-display">Pipeline</h1>
      <p className="t-lead mt-3 max-w-[44ch] text-ink-2">Every opportunity, where it stands. Choose a stage; select a row for the details.</p>
      <div className="mt-10">
        <PipelineExplorer initialStage={stage} />
      </div>
    </AppShell>
  );
}
