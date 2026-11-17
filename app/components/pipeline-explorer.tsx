"use client";

import { useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/app/components/workspace";
import { STAGE_LABEL, daysBetween, formatFloating, relativeDay } from "@/lib/recruiting/format";
import { lastMeaningful } from "@/lib/recruiting/history";
import type { Opportunity, Stage } from "@/lib/recruiting/types";

type View = "all" | Stage | "closed";
const STAGES: Stage[] = ["applied", "recruiter", "assessment", "interview", "offer"];
/** The overview reads from the most advanced stage down: what is closest to a decision comes first. */
const OVERVIEW_ORDER: Stage[] = ["offer", "interview", "assessment", "recruiter", "applied"];
const RAIL: View[] = ["all", ...STAGES, "closed"];
const OVERVIEW_VISIBLE = 5;

/**
 * Pipeline: where everything stands. Not a board: a rail of stages with counts, and under it compact lists. "All" reads the active
 * stages from the most advanced down, a few rows each and the rest one click away, so it stays calm with a hundred opportunities;
 * choosing a stage lists all of it. A filter narrows by company or role. Selecting a row opens the inspector in place.
 */
export function PipelineExplorer({ initialStage, controlledStage }: { initialStage?: string; controlledStage?: string }) {
  const { opportunities, now, selectedKey, open } = useWorkspace();
  const [viewState, setView] = useState<View>(RAIL.includes(initialStage as View) ? (initialStage as View) : "all");
  // The scripted presentation can drive the selected stage; normal use leaves this undefined.
  const view: View = RAIL.includes(controlledStage as View) ? (controlledStage as View) : viewState;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<Stage>>(new Set());
  const refs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  const activeOpps = useMemo(() => opportunities.filter((o) => o.status === "active"), [opportunities]);
  const closedOpps = useMemo(() => opportunities.filter((o) => o.status === "closed"), [opportunities]);
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

  const label = (v: View) => (v === "all" ? "All active" : v === "closed" ? "Closed" : STAGE_LABEL[v]);
  const row = (o: Opportunity) => <PipelineRow key={o.key} opp={o} now={now} active={selectedKey === o.key} onOpen={() => open(o.key)} />;

  let body: React.ReactNode;
  if (view === "all") {
    const sections = OVERVIEW_ORDER.map((s) => ({ s, list: byStage.get(s)!.filter(match) })).filter((x) => x.list.length > 0);
    body = sections.length === 0 ? (
      <Empty text={q ? "Nothing matches that filter." : "No active opportunities."} />
    ) : (
      <div className="space-y-9">
        {sections.map(({ s, list }) => {
          const showAll = expanded.has(s) || q.length > 0;
          const shown = showAll ? list : list.slice(0, OVERVIEW_VISIBLE);
          return (
            <section key={s} aria-label={STAGE_LABEL[s]}>
              <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
                <h2 className="t-heading">
                  {STAGE_LABEL[s]} <span className="tnum ml-1 font-normal text-ink-3">{list.length}</span>
                </h2>
                <button type="button" className="link-quiet t-meta" onClick={() => choose(s)}>
                  Open stage
                </button>
              </div>
              <ul className="list">{shown.map(row)}</ul>
              {list.length > OVERVIEW_VISIBLE && !q ? (
                <button
                  type="button"
                  className="link-quiet t-meta mt-2"
                  aria-expanded={showAll}
                  onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
                >
                  {showAll ? "Show fewer" : `Show ${list.length - OVERVIEW_VISIBLE} more`}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  } else {
    const list = (view === "closed" ? closedSorted : byStage.get(view)!).filter(match);
    body = list.length === 0 ? (
      <Empty text={q ? "Nothing matches that filter." : view === "closed" ? "Nothing closed yet." : `Nothing at ${STAGE_LABEL[view].toLowerCase()} right now.`} />
    ) : (
      <ul className="list">{list.map(row)}</ul>
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
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="max-w-[40ch] py-10 text-ink-2">{text}</p>;
}

function PipelineRow({ opp, now, active, onOpen }: { opp: Opportunity; now: Date; active: boolean; onOpen: () => void }) {
  const last = lastMeaningful(opp);
  const upcoming = last.scheduled && daysBetween(now, last.scheduled) >= 0;
  return (
    <li>
      <div className="row !items-center !py-2.5" data-active={active}>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="row-link block max-w-full truncate text-left text-[0.9375rem] font-medium tracking-tight">
            {opp.company}
          </button>
          <p className={`t-meta truncate ${opp.role ? "text-ink-2" : "text-ink-3"}`}>{opp.role ?? "No role detected"}</p>
        </div>
        <p className="t-meta hidden w-[11rem] shrink-0 text-ink-2 sm:block">{last.label.toLowerCase() === STAGE_LABEL[opp.stage].toLowerCase() ? "" : last.label}</p>
        <p className="t-meta tnum w-[8rem] shrink-0 text-right text-ink-3">
          {upcoming && last.scheduled ? <span className="text-ink">{formatFloating(last.scheduled, true)}</span> : relativeDay(now, last.at)}
        </p>
      </div>
    </li>
  );
}
