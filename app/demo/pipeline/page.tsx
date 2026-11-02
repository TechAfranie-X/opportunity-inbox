import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { PipelineExplorer } from "@/app/components/pipeline-explorer";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export const metadata = { title: "Demo pipeline · Opportunity Inbox" };

export default async function DemoPipeline({ searchParams }: PageProps<"/demo/pipeline">) {
  await connection();
  const { opportunities, now } = loadDemoWorkspace();
  const params = await searchParams;
  return (
    <AppShell demo active="pipeline" opportunities={opportunities} now={now}>
      <h1 className="t-display">Pipeline</h1>
      <p className="t-lead mt-3 max-w-[44ch] text-ink-2">Every opportunity, where it stands. Choose a stage; select a row for the details.</p>
      <div className="mt-10">
        <PipelineExplorer initialStage={typeof params.stage === "string" ? params.stage : undefined} />
      </div>
    </AppShell>
  );
}
