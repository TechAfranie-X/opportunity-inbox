import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/app/components/app-shell";
import { OpportunityHistory } from "@/app/components/recruiting-views";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export default async function DemoOpportunity({ params }: PageProps<"/demo/[key]">) {
  await connection();
  const { key } = await params;
  const { opportunities, now } = loadDemoWorkspace();
  const opportunity = opportunities.find((o) => o.key === decodeURIComponent(key));
  if (!opportunity) notFound();
  return (
    <AppShell demo active="pipeline" opportunities={opportunities} now={now}>
      <Link href="/demo/pipeline" className="link-quiet mb-10 inline-flex items-center gap-1.5">
        <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <path d="M5 1 1 5l4 4" />
        </svg>
        Pipeline
      </Link>
      <OpportunityHistory opportunity={opportunity} now={now} editable={false} />
    </AppShell>
  );
}
