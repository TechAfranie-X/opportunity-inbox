import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { PipelineList } from "@/app/components/recruiting-views";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export const metadata = { title: "Demo pipeline · Opportunity Inbox" };

export default async function DemoPipeline() {
  await connection();
  const { opportunities, now } = loadDemoWorkspace();
  const active = opportunities.filter((o) => o.status === "active").length;
  return (
    <AppShell demo active="pipeline">
      <h1 className="t-display">Pipeline</h1>
      <p className="t-meta tnum mt-5 text-ink-3">{active} active, {opportunities.length - active} closed</p>
      <div className="mt-14">
        <PipelineList opportunities={opportunities} now={now} basePath="/demo" />
      </div>
    </AppShell>
  );
}
