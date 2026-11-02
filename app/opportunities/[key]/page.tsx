import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { Timeline } from "@/app/components/recruiting-views";
import { isDatabaseConfigured } from "@/lib/db";
import { loadWorkspace, recordUsage } from "@/lib/recruiting/store";

export default async function OpportunityPage({ params }: PageProps<"/opportunities/[key]">) {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");

  const { key } = await params;
  const workspace = await loadWorkspace(sub);
  const opportunity = workspace.opportunities.find((o) => o.key === decodeURIComponent(key));
  if (!opportunity) notFound();
  await recordUsage(sub, "view_opportunity");

  return (
    <AppShell active="pipeline" userLabel={session?.user?.email ?? undefined}>
      <Link href="/pipeline" className="text-sm text-zinc-500 hover:text-foreground">← Pipeline</Link>
      <div className="mt-4">
        <Timeline opportunity={opportunity} editable />
      </div>
    </AppShell>
  );
}
