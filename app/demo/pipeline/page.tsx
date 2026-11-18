import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { PipelineExplorer } from "@/app/components/pipeline-explorer";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

import { isJob } from "@/lib/recruiting/format";
export const metadata = { title: "Demo pipeline · Opportunity Inbox" };

export default async function DemoPipeline({ searchParams }: PageProps<"/demo/pipeline">) {
  await connection();
  const { opportunities, now } = loadDemoWorkspace();
  const params = await searchParams;
  return (
    <AppShell demo active="pipeline" opportunities={opportunities} now={now} width="wide">
      <h1 className="t-display">Pipeline</h1>
      <p className="t-lead tnum mt-3 text-ink-2">
        {opportunities.filter((o) => isJob(o) && o.status === "active").length} active
        {opportunities.some((o) => isJob(o) && o.status === "closed") ? `, ${opportunities.filter((o) => isJob(o) && o.status === "closed").length} closed` : ""}
      </p>
      <div className="mt-10">
        <PipelineExplorer initialStage={typeof params.stage === "string" ? params.stage : undefined} />
      </div>
    </AppShell>
  );
}
