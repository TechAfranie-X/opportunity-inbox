import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { PipelineView } from "@/app/components/recruiting-views";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export const metadata = { title: "Demo pipeline · Opportunity Inbox" };

export default async function DemoPipeline() {
  await connection(); // render per request so sample dates stay relative to today
  const { opportunities, actions, now } = loadDemoWorkspace();
  return (
    <AppShell demo active="pipeline">
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
      <div className="mt-6">
        <PipelineView opportunities={opportunities} actions={actions} basePath="/demo" now={now} />
      </div>
    </AppShell>
  );
}
