import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/app-shell";
import { Timeline } from "@/app/components/recruiting-views";
import { loadDemoWorkspace } from "@/lib/recruiting/demo";

export default async function DemoOpportunity({ params }: PageProps<"/demo/[key]">) {
  await connection();
  const { key } = await params;
  const { opportunities } = loadDemoWorkspace();
  const opportunity = opportunities.find((o) => o.key === decodeURIComponent(key));
  if (!opportunity) notFound();
  return (
    <AppShell demo active="pipeline">
      <Link href="/demo/pipeline" className="text-sm text-zinc-500 hover:text-foreground">← Pipeline</Link>
      <div className="mt-4">
        <Timeline opportunity={opportunity} editable={false} />
      </div>
    </AppShell>
  );
}
