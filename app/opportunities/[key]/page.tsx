import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { OpportunityHistory } from "@/app/components/recruiting-views";
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
    <AppShell active="pipeline" user={session?.user}>
      <Link href="/pipeline" className="link-quiet mb-10 inline-flex items-center gap-1.5">
        <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <path d="M5 1 1 5l4 4" />
        </svg>
        Pipeline
      </Link>
      <OpportunityHistory opportunity={opportunity} editable />
    </AppShell>
  );
}
