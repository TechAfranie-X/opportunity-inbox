import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { ActivityStream } from "@/app/components/recruiting-views";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export const metadata = { title: "Demo activity · Opportunity Inbox" };

export default async function DemoActivity() {
  await connection();
  const { opportunities, now } = loadDemoWorkspace();
  return (
    <AppShell demo active="activity" opportunities={opportunities} now={now}>
      <h1 className="t-display">Activity</h1>
      <p className="t-lead mt-3 max-w-[44ch] text-ink-2">Everything that moved in your recruiting, newest first.</p>
      <div className="mt-10">
        <ActivityStream opportunities={opportunities} now={now} />
      </div>
    </AppShell>
  );
}
