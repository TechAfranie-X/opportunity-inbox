import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { TodayView } from "@/app/components/recruiting-views";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export const metadata = { title: "Demo · Opportunity Inbox" };

export default async function DemoToday() {
  await connection(); // render per request so sample dates stay relative to today
  const { actions } = loadDemoWorkspace();
  return (
    <AppShell demo active="today">
      <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
      <p className="mt-1 text-sm text-zinc-500">Built from a synthetic mailbox by the same pipeline that reads your Gmail.</p>
      <div className="mt-8">
        <TodayView actions={actions} basePath="/demo" editable={false} />
      </div>
    </AppShell>
  );
}
