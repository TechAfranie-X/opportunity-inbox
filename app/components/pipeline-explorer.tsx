"use client";

import { useMemo, useRef, useState } from "react";
import { EntityMark } from "@/app/components/entity-mark";
import { useWorkspace } from "@/app/components/workspace";
import { eventNeedsReview } from "@/lib/recruiting/opportunity";
import { STAGE_LABEL, compactWhen, relativeDay, roleLine, isJob } from "@/lib/recruiting/format";
import { lastMeaningful, nextMoment } from "@/lib/recruiting/history";
import type { Opportunity, Stage } from "@/lib/recruiting/types";

type View = "all" | Stage | "closed";
const STAGES: Stage[] = ["applied", "recruiter", "assessment", "interview", "offer"];
/** The board reads left to right as the journey. */
const OVERVIEW_ORDER: Stage[] = ["applied", "recruiter", "assessment", "interview", "offer"];
const RAIL: View[] = ["all", ...STAGES, "closed"];
const OVERVIEW_VISIBLE = 6;

/**
 * Pipeline: where everything stands, with the opportunity as the unit. "All active" is a compact board that reads left to right as the journey,
 * a handful of cards per stage (the ones with something dated first) and the rest one click away, so it stays calm with a hundred
 * opportunities. Choosing a stage shows all of it as a grid of cards. A filter narrows by company or role. Selecting a card opens the
 * inspector in place.
 */
export function PipelineExplorer({ initialStage, controlledStage }: { initialStage?: string; controlledStage?: string }) {
  const { opportunities, now, selectedKey, open } = useWorkspace();
  const [viewState, setView] = useState<View>(RAIL.includes(initialStage as View) ? (initialStage as View) : "all");
  // The scripted presentation can drive the selected stage; normal use leaves this undefined.
  const view: View = RAIL.includes(controlledStage as View) ? (controlledStage as View) : viewState;
  const [query, setQuery] = useState("");
  const refs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  const jobs = useMemo(() => opportunities.filter(isJob), [opportunities]);
  const others = useMemo(() => opportunities.filter((o) => !isJob(o)), [opportunities]);
  const activeOpps = useMemo(() => jobs.filter((o) => o.status === "active"), [jobs]);
  const closedOpps = useMemo(() => jobs.filter((o) => o.status === "closed"), [jobs]);
  const byStage = useMemo(() => {
    const m = new Map<Stage, Opportunity[]>();
    for (const s of STAGES) m.set(s, []);
    for (const o of activeOpps) m.get(o.stage)?.push(o);
    for (const list of m.values()) list.sort((a, b) => lastMeaningful(b).at.getTime() - lastMeaningful(a).at.getTime());
    return m;
  }, [activeOpps]);
  const closedSorted = useMemo(() => [...closedOpps].sort((a, b) => lastMeaningful(b).at.getTime() - lastMeaningful(a).at.getTime()), [closedOpps]);

  const q = query.trim().toLowerCase();
  const match = (o: Opportunity) => !q || `${o.company} ${o.role ?? ""}`.toLowerCase().includes(q);
  const counts: Record<View, number> = { all: activeOpps.length, closed: closedOpps.length, applied: 0, recruiter: 0, assessment: 0, interview: 0, offer: 0 };
  for (const s of STAGES) counts[s] = byStage.get(s)!.length;

  const choose = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("stage", next);
    window.history.replaceState(null, "", url);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = RAIL.indexOf(view);
    const n = e.key === "ArrowRight" ? Math.min(i + 1, RAIL.length - 1) : e.key === "ArrowLeft" ? Math.max(i - 1, 0) : i;
    if (n !== i) {
      e.preventDefault();
      choose(RAIL[n]);
      refs.current[RAIL[n]]?.focus();
    }
  };

  const label = (v: View) => (v === "all" ? "All open" : v === "closed" ? "Closed" : STAGE_LABEL[v]);

  const rank = (o: Opportunity) => {
    const n = nextMoment(o, now);
    return [n ? n.date.getTime() : Number.POSITIVE_INFINITY, -lastMeaningful(o).at.getTime()] as const;
  };
  const ordered = (list: Opportunity[]) => [...list].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });
  const card = (o: Opportunity) => <OppCard key={o.key} opp={o} now={now} active={selectedKey === o.key} onOpen={() => open(o.key)} />;

  let body: React.ReactNode;
  if (view === "all") {
    const columns = OVERVIEW_ORDER.map((s) => ({ s, list: ordered(byStage.get(s)!.filter(match)) }));
    const any = columns.some((c) => c.list.length > 0);
    body = !any ? (
      <Empty text={q ? "Nothing matches that filter." : "No active opportunities."} />
    ) : (
      <div className="-mx-6 flex snap-x scroll-pl-6 gap-3 overflow-x-auto px-6 pb-3 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
        {columns.map(({ s, list }) => (
          <section key={s} aria-label={STAGE_LABEL[s]} className="min-w-[15.5rem] snap-start rounded-lg border border-line bg-[var(--tint)] p-2 lg:min-w-0">
            <div className="flex items-baseline justify-between gap-2 px-1.5 pb-2 pt-1">
              <h2 className="t-heading">{STAGE_LABEL[s]}</h2>
              <span className="tnum t-meta text-ink-3">{counts[s]}</span>
            </div>
            <div className="space-y-2">
              {list.slice(0, OVERVIEW_VISIBLE).map(card)}
              {list.length === 0 ? <p className="t-meta px-1 py-3 text-ink-3">{q ? "No match" : "Nothing here"}</p> : null}
            </div>
            {list.length > OVERVIEW_VISIBLE ? (
              <button type="button" className="link-quiet t-meta mt-2 px-1" onClick={() => choose(s)}>
                {list.length - OVERVIEW_VISIBLE} more
              </button>
            ) : null}
          </section>
        ))}
      </div>
    );
  } else {
    const list = ordered(view === "closed" ? closedSorted.filter(match) : byStage.get(view)!.filter(match));
    body = list.length === 0 ? (
      <Empty text={q ? "Nothing matches that filter." : view === "closed" ? "Nothing closed yet." : `Nothing at ${STAGE_LABEL[view].toLowerCase()} right now.`} />
    ) : (
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{list.map(card)}</div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
        <div className="-mb-px flex max-w-full gap-x-5 overflow-x-auto" role="tablist" aria-label="Stage" onKeyDown={onKey}>
          {RAIL.map((v) => (
            <button
              key={v}
              ref={(el) => {
                refs.current[v] = el;
              }}
              role="tab"
              id={`tab-${v}`}
              aria-selected={view === v}
              aria-controls="stage-panel"
              tabIndex={view === v ? 0 : -1}
              onClick={() => choose(v)}
              className={`relative shrink-0 whitespace-nowrap pb-3 pt-1 text-[0.875rem] transition-colors ${view === v ? "font-medium text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              {label(v)} <span className="tnum ml-0.5 text-ink-3">{counts[v]}</span>
              {view === v ? <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-accent" /> : null}
            </button>
          ))}
        </div>
        <label className="mb-2 block w-full sm:w-56">
          <span className="sr-only">Filter by company or role</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by company or role" className="input !h-8 !text-[0.8125rem]" />
        </label>
      </div>
      <div id="stage-panel" role="tabpanel" aria-labelledby={`tab-${view}`} key={`${view}-${q}`} className="fade-in mt-6">
        {body}
      </div>
      {others.length > 0 ? (
        <section className="mt-10" aria-label="Scholarships, fellowships and programs">
          <h2 className="t-heading">Scholarships, fellowships and programs</h2>
          <p className="t-meta mt-1 max-w-[56ch] text-ink-2">Applications that are not jobs or internships. They are kept here and are not counted in your pipeline.</p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{others.filter(match).map(card)}</div>
        </section>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="max-w-[40ch] py-10 text-ink-2">{text}</p>;
}

/** A compact opportunity card: who, what it is, what is next (or what just moved), and whether we are unsure. The whole card opens the inspector. */
function OppCard({ opp, now, active, onOpen }: { opp: Opportunity; now: Date; active: boolean; onOpen: () => void }) {
  const last = lastMeaningful(opp);
  const next = nextMoment(opp, now);
  const unsure = opp.events.some((e) => !e.outbound && eventNeedsReview(e));
  const closedNote = opp.outcome === "accepted" && opp.status !== "closed" ? "Accepted" : opp.status === "closed" ? (opp.closedBy === "completed" ? "Completed" : opp.closedBy === "expired" ? "Expired" : opp.closedBy === "not_recruiting" ? "Not recruiting" : opp.outcome === "rejected" ? "Rejected" : opp.outcome === "offer" ? "Offer" : opp.outcome === "withdrawn" ? "Withdrawn" : "Closed") : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-active={active}
      className="panel relative block w-full bg-[var(--paper)] p-3 text-left transition-colors hover:border-[var(--ink-3)] data-[active=true]:border-[var(--accent)]"
    >
      <span className="flex items-start gap-2.5">
        <EntityMark opportunity={opp} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium leading-tight tracking-tight">{opp.company}</span>
          <span className={`t-meta mt-0.5 block truncate ${opp.role ? "text-ink-2" : "text-ink-3"}`}>{roleLine(opp)}</span>
        </span>
        {unsure ? (
          <span className="status-dot mt-1.5 shrink-0" title="Needs review">
            <span className="sr-only">Needs review</span>
          </span>
        ) : null}
      </span>
      <span className="t-meta tnum mt-2.5 block truncate text-ink-3">
        {closedNote ? `${closedNote} · ${relativeDay(now, last.at)}` : next ? <span className={next.kind === "deadline" ? "text-[var(--warn)]" : "text-ink"}>{next.kind === "deadline" ? "Due " : ""}{compactWhen(now, next.date, next.hasTime)}</span> : `${last.label} · ${relativeDay(now, last.at)}`}
      </span>
    </button>
  );
}
