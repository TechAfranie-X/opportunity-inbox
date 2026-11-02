import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { deleteMyDataAction, disconnectGmailAction } from "@/app/actions";
import { AppShell } from "@/app/components/app-shell";
import { PipelineView } from "@/app/components/recruiting-views";
import { SyncButton } from "@/app/components/sync-button";
import { isDatabaseConfigured } from "@/lib/db";
import { loadWorkspace } from "@/lib/recruiting/store";

export const metadata = { title: "Pipeline · Opportunity Inbox" };

export default async function PipelinePage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const workspace = await loadWorkspace(sub);

  return (
    <AppShell active="pipeline" userLabel={session?.user?.email ?? undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <SyncButton />
      </div>
      <div className="mt-6">
        <PipelineView opportunities={workspace.opportunities} actions={workspace.actions} basePath="/opportunities" now={new Date()} />
      </div>

      <section className="mt-16 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        <h2 className="font-semibold text-foreground">Your data</h2>
        <p className="mt-1 max-w-xl">
          We store the company, role, stage, dates, sender and subject of recruiting emails, plus a link back to Gmail. We never store message bodies.
        </p>
        <div className="mt-3 flex gap-2">
          <form action={deleteMyDataAction}><button type="submit" className="appearance-none rounded-md border border-zinc-300 px-2.5 py-1 font-medium dark:border-zinc-700">Delete my derived data</button></form>
          <form action={disconnectGmailAction}><button type="submit" className="appearance-none rounded-md border border-red-300 px-2.5 py-1 font-medium text-red-700 dark:border-red-900 dark:text-red-400">Disconnect Gmail &amp; delete everything</button></form>
        </div>
      </section>
    </AppShell>
  );
}
