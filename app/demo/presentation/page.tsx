import { Greeting } from "@/app/components/greeting";
import { PresentationDirector } from "@/app/components/presentation/director";
import { OpportunityHistory, TodayComposition } from "@/app/components/recruiting-views";
import { buildBriefing } from "@/lib/recruiting/briefing";
import { buildPresentationWorkspace } from "@/lib/recruiting/presentation-data";

export const metadata = { title: "Opportunity Inbox · Presentation" };

/**
 * A scripted 30-second tour of the product for screen recording. Synthetic, fictional data only;
 * the clock is pinned so every replay is identical. `?speed=2` plays faster (a test aid).
 */
export default async function PresentationPage({ searchParams }: PageProps<"/demo/presentation">) {
  const w = buildPresentationWorkspace();
  const params = await searchParams;
  const raw = typeof params.speed === "string" ? Number(params.speed) : 1;
  const speed = Number.isFinite(raw) ? Math.min(8, Math.max(0.25, raw)) : 1;

  const needs = buildBriefing(w.opportunities, w.actions, w.now).needsYou.length;
  const today = w.now.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const history = w.opportunities.find((o) => o.key === w.historyKey)!;

  return (
    <>
      {/* Pin light before first paint so a saved dark preference never flashes. */}
      <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.dataset.theme="light"' }} />
      <PresentationDirector
      opportunities={w.opportunities}
      now={w.now}
      heroKey={w.heroKey}
      historyKey={w.historyKey}
      emailCount={w.emailCount}
      speed={speed}
      todayNode={
        <>
          <Greeting hour={9} needsYou={needs}>
            <span>{today}</span>
          </Greeting>
          <TodayComposition
            opportunities={w.opportunities}
            actions={w.actions}
            now={w.now}
            basePath="/demo"
            pipelineHref="/demo/pipeline"
            editable
            greeting={null}
          />
        </>
      }
      historyNode={<OpportunityHistory opportunity={history} now={w.now} editable />}
      />
    </>
  );
}
