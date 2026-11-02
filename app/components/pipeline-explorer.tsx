"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useWorkspace } from "@/app/components/workspace";
import { STAGE_LABEL, daysBetween, formatFloating, relativeDay } from "@/lib/recruiting/format";
import { lastMeaningful } from "@/lib/recruiting/history";
import type { Opportunity, Stage } from "@/lib/recruiting/types";

type Tab = Stage | "closed";
const TABS: Tab[] = ["applied", "recruiter", "assessment", "interview", "offer", "closed"];

/**
 * Pipeline as a journey, not a board. The stages sit on one hairline; the accent marker travels to
 * the selected stage and the list beneath eases in. Selecting a row opens the inspector in place.
 */
export function PipelineExplorer({ initialStage, controlledStage }: { initialStage?: string; controlledStage?: string }) {
  const { opportunities, now, selectedKey, open } = useWorkspace();

  const grouped = (tab: Tab) =>
    opportunities.filter((o) => (tab === "closed" ? o.status === "closed" : o.status === "active" && o.stage === tab));
  const counts = Object.fromEntries(TABS.map((t) => [t, grouped(t).length])) as Record<Tab, number>;

  // Default to the most advanced stage that has anything in it.
  const fallback = ([...TABS].reverse().find((t) => t !== "closed" && counts[t] > 0) ?? "applied") as Tab;
  const [tabState, setTab] = useState<Tab>(TABS.includes(initialStage as Tab) ? (initialStage as Tab) : fallback);
  // The presentation director can drive the selected stage; normal use leaves this undefined.
  const tab: Tab = TABS.includes(controlledStage as Tab) ? (controlledStage as Tab) : tabState;

  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const el = refs.current[tab];
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const choose = (next: Tab) => {
    if (controlledStage) return;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("stage", next);
    window.history.replaceState(null, "", url);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const nextIndex = e.key === "ArrowRight" ? Math.min(i + 1, TABS.length - 1) : e.key === "ArrowLeft" ? Math.max(i - 1, 0) : i;
    if (nextIndex !== i) {
      e.preventDefault();
      choose(TABS[nextIndex]);
      refs.current[TABS[nextIndex]]?.focus();
    }
  };

  const rows = grouped(tab);

  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div role="tablist" aria-label="Stage" onKeyDown={onKey} className="relative flex min-w-max items-end gap-x-2 border-b border-line sm:gap-x-4">
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="stage-panel"
            tabIndex={tab === t ? 0 : -1}
            onClick={() => choose(t)}
            className={`group relative shrink-0 px-1 pb-4 pt-2 text-left transition-colors sm:px-2 ${t === "closed" ? "ml-auto" : ""} ${
              tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            <span className="block text-[1.0625rem] font-medium tracking-tight">{STAGE_LABEL[t]}</span>
            <span className="t-meta tnum block">{counts[t]}</span>
            {/* a dot per stage sits on the hairline: the journey, one stop at a time */}
            <i
              aria-hidden
              className="absolute -bottom-[3.5px] left-1 block h-[7px] w-[7px] rounded-full sm:left-2"
              style={{ background: "var(--paper)", boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
            />
          </button>
        ))}
        {bar ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-px left-0 h-[2px] rounded-full bg-accent"
            style={{
              width: bar.width,
              transform: `translateX(${bar.left}px)`,
              transition: "transform var(--dur-3) var(--ease), width var(--dur-3) var(--ease)",
            }}
          />
        ) : null}
        {bar ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-[3.5px] left-0 block h-[7px] w-[7px] rounded-full bg-accent"
            style={{
              transform: `translateX(${bar.left + (typeof window !== "undefined" && window.innerWidth >= 640 ? 8 : 4)}px)`,
              boxShadow: "0 0 0 4px var(--accent-wash)",
              transition: "transform var(--dur-3) var(--ease)",
            }}
          />
        ) : null}
      </div>
      </div>

      <div id="stage-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} key={tab} className="fade-in mt-2">
        {rows.length === 0 ? (
          <p className="t-lead max-w-[36ch] py-12 text-ink-2">
            {tab === "closed" ? "Nothing closed yet." : `Nothing at ${STAGE_LABEL[tab].toLowerCase()} right now.`}
          </p>
        ) : (
          <ul className="list">
            {rows.map((o) => (
              <PipelineRow key={o.key} opp={o} now={now} active={selectedKey === o.key} onOpen={() => open(o.key)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PipelineRow({ opp, now, active, onOpen }: { opp: Opportunity; now: Date; active: boolean; onOpen: () => void }) {
  const last = lastMeaningful(opp);
  const upcoming = last.scheduled && daysBetween(now, last.scheduled) >= 0;
  return (
    <li>
      <div className="row !items-center" data-active={active}>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="row-link block max-w-full truncate text-left text-[1.0625rem] font-medium tracking-tight">
            {opp.company}
          </button>
          <p className={`t-meta mt-0.5 truncate ${opp.role ? "text-ink-2" : "text-ink-3"}`}>{opp.role ?? "No role detected"}</p>
        </div>
        <div className="hidden w-[11rem] shrink-0 sm:block">
          <p className="t-meta text-ink-2">{last.label}</p>
        </div>
        <p className="t-meta tnum w-[8.5rem] shrink-0 text-right text-ink-3">
          {upcoming && last.scheduled ? <span className="text-ink">{formatFloating(last.scheduled, true)}</span> : relativeDay(now, last.at)}
        </p>
      </div>
    </li>
  );
}
