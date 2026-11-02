import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { Greeting } from "@/app/components/greeting";
import { TodayComposition } from "@/app/components/recruiting-views";
import { buildBriefing } from "@/lib/recruiting/briefing";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export const metadata = { title: "Demo · Opportunity Inbox" };

export default async function DemoToday() {
  await connection(); // render per request so sample dates stay relative to today
  const { opportunities, actions, now } = loadDemoWorkspace();
  const needs = buildBriefing(opportunities, actions, now).needsYou.length;
  const today = now.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  return (
    <AppShell demo active="today" opportunities={opportunities} now={now}>
      <Greeting name="Sam" hour={9} needsYou={needs}>
        <span>{today}</span>
      </Greeting>
      <TodayComposition opportunities={opportunities} actions={actions} now={now} basePath="/demo" pipelineHref="/demo/pipeline" editable={false} greeting={null} />
    </AppShell>
  );
}
