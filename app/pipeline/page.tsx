import { pipelineBuckets } from "@/lib/recruiting/history";
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

  const b = pipelineBuckets(workspace.opportunities, now);
  const headline = [`${b.active.length} active`, b.quiet.length ? `${b.quiet.length} quiet for two months or more` : "", b.accepted.length ? `${b.accepted.length} accepted` : "", b.closed.length ? `${b.closed.length} closed` : "", b.other.length ? `${b.other.length} programs and events` : ""].filter(Boolean).join(" · ");

  return (
    <AppShell active="pipeline" user={session?.user} updated={updated} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="wide">
      <h1 className="t-display">Pipeline</h1>
      <p className="t-lead tnum mt-3 text-ink-2">
        {headline}
      </p>
      <div className="mt-10">
        <PipelineExplorer initialStage={stage} />
      </div>
    </AppShell>
  );
}
