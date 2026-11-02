"use client";

import { useState } from "react";
import { JourneyLine } from "@/app/components/journey-line";
import { useWorkspace } from "@/app/components/workspace";
import { annotateTimeline, nextMoment, peopleFor, stageSince } from "@/lib/recruiting/history";
import {
  STAGE_LABEL,
  formatFloating,
  formatWhen,
  gmailThreadUrl,
  relativeDay,
} from "@/lib/recruiting/format";

function shortDay(date: Date) {
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/**
 * Quick context without leaving the current screen: a glass panel that glides in from the right
 * (and leaves the way it came). On narrow screens it becomes a bottom sheet.
 */
export function Inspector() {
  const { opportunities, now, basePath, editable, selectedKey, close } = useWorkspace();
  const opp = opportunities.find((o) => o.key === selectedKey) ?? null;
  const open = opp !== null;
  const [showMinor, setShowMinor] = useState(false);

  const items = opp ? annotateTimeline(opp.events) : [];
  const major = items.filter((i) => i.major);
  const minorCount = items.length - major.length;
  const visible = showMinor ? items : major;
  const next = opp ? nextMoment(opp, now) : null;
  const people = opp ? peopleFor(opp, 2) : [];
  const since = opp ? stageSince(opp) : null;
  const latestInbound = opp ? [...opp.events].reverse().find((e) => !e.outbound) : null;

  return (
    <>
      <div className="scrim" data-open={open} onClick={close} aria-hidden />
      <aside className="inspector glass-thick" data-open={open} aria-label="Opportunity details" aria-hidden={!open} inert={!open}>
        {opp ? (
          <div className="flex min-h-0 flex-1 flex-col" key={opp.key}>
            <div className="inspector-body min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="t-title break-words">{opp.company}</h2>
                  <p className="t-meta mt-1 text-ink-2">{opp.role ?? "No role detected"}</p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close details"
                  className="-mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-wash hover:text-ink"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                    <path d="m1 1 9 9M10 1 1 10" />
                  </svg>
                </button>
              </div>

              <div className="mt-6">
                <JourneyLine stage={opp.stage} surface="raised" />
                <p className="t-meta mt-3 text-ink-3">
                  {opp.status === "closed"
                    ? opp.outcome === "rejected"
                      ? "Closed after a rejection"
                      : opp.outcome === "offer"
                        ? "Closed with an offer"
                        : "Closed"
                    : `${STAGE_LABEL[opp.stage]} since ${shortDay(since!)}`}
                </p>
              </div>

              {next ? (
                <div className="mt-6 border-t border-line pt-5">
                  <p className="t-meta text-ink-3">{next.label}</p>
                  <p className="mt-0.5 text-[1.0625rem] font-medium tnum">{formatWhen(next.date, next.hasTime).replace(" at ", " · ")}</p>
                  <p className="t-meta mt-0.5 text-ink-2">{relativeDay(now, next.date)}</p>
                </div>
              ) : null}

              {people.length > 0 ? (
                <p className="t-meta mt-5 text-ink-2">
                  <span className="text-ink-3">With </span>
                  {people.join(", ")}
                </p>
              ) : null}

              <h3 className="t-meta mt-8 text-ink-3">Timeline</h3>
              <ol className="mt-3 border-l border-line">
                {visible.map((item) => (
                  <li key={item.event.gmailMessageId} className="relative pb-4 pl-5 last:pb-0">
                    <span
                      className="absolute -left-px top-[0.5rem] h-[6px] w-[6px] -translate-x-1/2 rounded-full"
                      style={{ background: item.major ? (item.current ? "var(--accent)" : "var(--ink)") : "var(--line-strong)" }}
                      aria-hidden
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={`text-[0.9375rem] ${item.major ? "font-medium tracking-tight" : "text-ink-2"} ${item.superseded ? "text-ink-3 line-through decoration-line-strong" : ""}`}>
                        {item.label}
                      </p>
                      <span className="t-meta tnum shrink-0 text-ink-3">{shortDay(item.event.occurredAt)}</span>
                    </div>
                    {item.event.eventDate ? (
                      <p className={`t-meta tnum ${item.superseded ? "text-ink-3 line-through decoration-line-strong" : "text-ink-2"}`}>
                        {item.event.dateKind === "deadline" ? "Due " : ""}
                        {formatFloating(item.event.eventDate, item.event.eventDateHasTime)}
                        {item.current && item.label !== "Interview scheduled" ? " · now" : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              {minorCount > 0 ? (
                <button type="button" className="link-quiet t-meta mt-3" onClick={() => setShowMinor((v) => !v)}>
                  {showMinor ? "Hide smaller updates" : `Show ${minorCount} smaller update${minorCount === 1 ? "" : "s"}`}
                </button>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-3.5">
              {editable && latestInbound ? (
                <a className="link-quiet t-meta" href={gmailThreadUrl(latestInbound.gmailThreadId)} target="_blank" rel="noreferrer">
                  Open latest email
                </a>
              ) : (
                <span />
              )}
              <a className="text-sm font-medium text-ink transition-opacity hover:opacity-70" href={`${basePath}/${encodeURIComponent(opp.key)}`}>
                Full history →
              </a>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}
