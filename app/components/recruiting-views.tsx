import Link from "next/link";
import {
  dismissActionAction,
  confirmEventAction,
  editEventAction,
  ignoreEventAction,
  resetEventAction,
  setOpportunityStatusAction,
} from "@/app/actions";
import { Disclose } from "@/app/components/disclose";
import { EventTools } from "@/app/components/event-tools";
import { Menu } from "@/app/components/menu";
import { EntityMark } from "@/app/components/entity-mark";
import { IconChevron, IconClock, IconPipeline } from "@/app/components/icons";
import { OpenOpportunity } from "@/app/components/workspace";
import { buildBriefing, describeAction } from "@/lib/recruiting/briefing";
import {
  EVENT_LABEL,
  STAGE_LABEL,
  daysBetween,
  formatFloating,
  formatWhen,
  gmailThreadUrl,
  relativeDay,
  toInputValue,
} from "@/lib/recruiting/format";
import { annotateTimeline, nextMoment, peopleFor, pulse, stageSince } from "@/lib/recruiting/history";
import { entityState, stageMilestones } from "@/lib/recruiting/presentation";
import { EVENT_TYPES, type ActionItem, type ActionKind, type EffectiveEvent, type Opportunity } from "@/lib/recruiting/types";

function shortDay(date: Date) {
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function SectionHead({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="t-heading flex items-baseline gap-2">
        {title}
        {count !== undefined ? <span className="tnum text-[0.9375rem] font-normal text-ink-3">{count}</span> : null}
      </h2>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Today */

function ActionMenu({
  item,
  editable,
  lean = false,
  align = "right",
}: {
  item: ActionItem;
  editable: boolean;
  lean?: boolean;
  align?: "left" | "right";
}) {
  return (
    <Menu label={`More for ${item.company}`} align={align}>
      <OpenOpportunity opportunityKey={item.opportunityKey} className="menu-item" role="menuitem">
        View history
      </OpenOpportunity>
      {item.sourceThreadId && editable && !lean ? (
        <a className="menu-item" role="menuitem" href={gmailThreadUrl(item.sourceThreadId)} target="_blank" rel="noreferrer">
          Open email
        </a>
      ) : null}
      {editable ? (
        <form action={dismissActionAction}>
          <input type="hidden" name="actionId" value={item.id} />
          <button type="submit" className="menu-item" role="menuitem">
            Mark done
          </button>
        </form>
      ) : null}
    </Menu>
  );
}

/** "Applied 19 days ago with no update" becomes "19 days quiet". */
function quietFor(reason: string) {
  const m = reason.match(/(\d+) days? ago/);
  return m ? `${m[1]} days quiet` : reason.replace(/ — consider.*$/, "");
}

function WaitingRow({ item, editable }: { item: ActionItem; editable: boolean }) {
  return (
    <li>
      <div className="row !py-2.5">
        <OpenOpportunity opportunityKey={item.opportunityKey} className="row-link min-w-0 truncate">
          <span className="text-ink transition-colors">{item.company}</span>
          {item.role ? <span className="t-meta text-ink-3"> {item.role}</span> : null}
        </OpenOpportunity>
        <div className="row-end shrink-0">
          <span className="row-time t-meta tnum text-ink-3">{quietFor(item.reason)}</span>
          <div className="row-tools">
            <ActionMenu item={item} editable={editable} />
          </div>
        </div>
      </div>
    </li>
  );
}

const PILL: Record<ActionKind, { label: string; tone: "accent" | "ok" | "plain" }> = {
  upcoming_interview: { label: "Interview", tone: "accent" },
  schedule_interview: { label: "Interview", tone: "accent" },
  assessment_deadline: { label: "Assessment", tone: "plain" },
  offer_decision: { label: "Offer", tone: "ok" },
  respond_recruiter: { label: "Recruiter", tone: "plain" },
  follow_up: { label: "Follow up", tone: "plain" },
  check_in: { label: "Check in", tone: "plain" },
};

/** One line that says what is happening, in words: "Interview tomorrow · 12:00 PM", "Assessment due Nov 18", "Reply to the recruiter". */
function summaryLine(item: ActionItem, now: Date): string {
  const c = describeAction(item, now);
  const when = item.due ? (item.dueHasTime ? `${relativeDay(now, item.due)} · ${item.due.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" })}` : relativeDay(now, item.due)) : null;
  const day = item.due ? item.due.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) : null;
  switch (item.kind) {
    case "upcoming_interview": return `Interview ${when ?? ""}`.trim();
    case "assessment_deadline": return c.critical && item.bucket === "overdue" ? `Assessment was due ${day}` : `Assessment due ${day ?? ""}`.trim();
    case "offer_decision": return day ? `Offer decision by ${day}` : "Offer decision";
    case "schedule_interview": return "Reply to book your interview";
    case "respond_recruiter": return "Reply to the recruiter";
    case "follow_up": return "Worth a follow-up";
    default: return "Worth a check-in";
  }
}

/**
 * The work, as one list: who (a mark), what is happening and when, the role, and a pill for what kind of thing it is. The whole row opens the
 * opportunity; the quiet menu appears on hover or focus in place of the chevron.
 */
function ActionRows({ items, opportunities, now, editable }: { items: ActionItem[]; opportunities: Opportunity[]; now: Date; editable: boolean }) {
  return (
    <ul className="list">
      {items.map((item) => {
        const opp = opportunities.find((o) => o.key === item.opportunityKey);
        const pill = PILL[item.kind];
        const critical = describeAction(item, now).critical;
        return (
          <li key={item.id}>
            <div className="row !items-center !gap-4 !py-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                {opp ? <EntityMark opportunity={opp} size="lg" /> : <EntityMark name={item.company} size="lg" />}
                <div className="min-w-0">
                  <OpenOpportunity opportunityKey={item.opportunityKey} className="row-link block truncate font-medium tracking-tight">
                    {summaryLine(item, now)}
                  </OpenOpportunity>
                  <p className="t-meta mt-0.5 truncate text-ink-2">
                    {item.company}
                    {item.role ? ` · ${item.role}` : ""}
                  </p>
                </div>
              </div>
              <span className="pill shrink-0" data-tone={critical ? "critical" : pill.tone}>
                {pill.label}
              </span>
              <div className="row-end w-6 shrink-0">
                <span className="row-time text-ink-3">
                  <IconChevron />
                </span>
                <div className="row-tools">
                  <ActionMenu item={item} editable={editable} />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** What is coming, as a compact schedule: day, who and what, time. */
function ScheduleRows({ items, now }: { items: ActionItem[]; now: Date }) {
  const sorted = [...items].sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  return (
    <ul className="list">
      {sorted.map((item) => (
        <li key={item.id}>
          <div className="row !items-center !gap-4 !py-2.5">
            <span className="t-meta tnum w-[6.25rem] shrink-0 text-ink-3">{item.due ? item.due.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : ""}</span>
            <OpenOpportunity opportunityKey={item.opportunityKey} className="row-link min-w-0 flex-1 truncate text-[0.9375rem]">
              <span className="font-medium">{item.company}</span>
              <span className="text-ink-2"> — {describeAction(item, now).headline.replace(item.company, "").replace(/\s+/g, " ").trim() || PILL[item.kind].label}</span>
            </OpenOpportunity>
            <span className="t-meta tnum shrink-0 text-ink-3">
              {item.due && item.dueHasTime ? item.due.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }) : item.bucket === "overdue" ? "Overdue" : "All day"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Where everything stands: a count, one flat segmented bar (quantity, not rank), and the stages. Each row opens that stage. */
function PipelineCard({ opportunities, pipelineHref }: { opportunities: Opportunity[]; pipelineHref: string }) {
  const rows = pulse(opportunities);
  const active = opportunities.filter((o) => o.status === "active").length;
  const total = Math.max(1, rows.reduce((n, r) => n + r.count, 0));
  if (opportunities.length === 0) {
    return (
      <section aria-label="Your pipeline" className="panel p-4">
        <h2 className="t-heading flex items-center gap-2"><IconPipeline /> Your pipeline</h2>
        <p className="t-meta mt-3 max-w-[30ch] text-ink-2">No opportunities yet. They appear here as recruiting mail arrives.</p>
      </section>
    );
  }
  return (
    <section aria-label="Your pipeline" className="panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="t-heading flex items-center gap-2 text-ink-2"><IconPipeline /> Your pipeline</h2>
        <Link href={pipelineHref} className="link-quiet t-meta">Open</Link>
      </div>
      <p className="mt-3 text-[1.5rem] font-medium leading-none tracking-tight"><span className="tnum">{active}</span> <span className="text-[1rem] font-normal text-ink-2">active</span></p>
      <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {rows.filter((r) => r.count > 0).map((r, i) => (
          <span key={r.stage} className="block h-full" style={{ width: `${(r.count / total) * 100}%`, background: "var(--ink-3)", opacity: 0.35 + i * 0.16 }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {rows.map((r) => (
          <li key={r.stage}>
            <Link href={`${pipelineHref}?stage=${r.stage}`} className="group flex items-center justify-between text-[0.875rem]">
              <span className={`transition-colors group-hover:text-ink ${r.count === 0 ? "text-ink-3" : "text-ink-2"}`}>{STAGE_LABEL[r.stage]}</span>
              <span className={`tnum ${r.count === 0 ? "text-ink-3" : "font-medium"}`}>{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What changed, newest first: a mark, the company, what happened, and when. */
function RecentCard({ opportunities, now, activityHref }: { opportunities: Opportunity[]; now: Date; activityHref: string }) {
  const { recent } = buildBriefing(opportunities, [], now);
  if (recent.length === 0) return null;
  return (
    <section aria-label="Recent changes" className="panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="t-heading flex items-center gap-2 text-ink-2"><IconClock /> Recent changes</h2>
        <Link href={activityHref} className="link-quiet t-meta">All</Link>
      </div>
      <ul className="mt-3 space-y-3">
        {recent.map((c) => {
          const opp = opportunities.find((o) => o.key === c.opportunityKey);
          return (
            <li key={c.opportunityKey}>
              <OpenOpportunity opportunityKey={c.opportunityKey} className="group flex items-center gap-3">
                {opp ? <EntityMark opportunity={opp} size="sm" /> : <EntityMark name={c.company} size="sm" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-medium">{c.company}</span>
                  <span className="t-meta block truncate text-ink-2">{c.label}</span>
                </span>
                <span className="t-meta shrink-0 text-ink-3">{relativeDay(now, c.when)}</span>
              </OpenOpportunity>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const NEEDS_VISIBLE = 4;

/**
 * Today is the personal command center. The work on the left (what needs you now as one list, then what is coming); on the right the state of
 * things (the pipeline, what changed, what needs review). Quiet things are present but folded. When nothing needs you it says so, plainly.
 */
export function TodayComposition({
  opportunities,
  actions,
  now,
  pipelineHref,
  editable,
  greeting,
  toCheck = 0,
  checkHref = "/review",
  updated,
}: {
  opportunities: Opportunity[];
  actions: ActionItem[];
  now: Date;
  basePath?: string;
  pipelineHref: string;
  editable: boolean;
  greeting: React.ReactNode;
  /** Reviews that matter to live recruiting (signed-in product only). */
  toCheck?: number;
  checkHref?: string;
  /** Preformatted time of the last read. */
  updated?: string;
}) {
  const briefing = buildBriefing(opportunities, actions, now);
  const needs = [...briefing.needsYou].sort((a, b) => b.priority - a.priority);
  const activityHref = pipelineHref.replace(/pipeline$/, "activity");
  const next = briefing.comingUp[0];

  return (
    <div>
      {greeting}
      <div className="cc mt-8">
        <div className="min-w-0 space-y-9">
          {needs.length > 0 ? (
            <section aria-label="Needs you now">
              <div className="panel px-2 sm:px-3">
                <ActionRows items={needs.slice(0, NEEDS_VISIBLE)} opportunities={opportunities} now={now} editable={editable} />
              </div>
              {needs.length > NEEDS_VISIBLE ? (
                <Disclose className="mt-3" summary={`${needs.length - NEEDS_VISIBLE} more need you`} openSummary="Show fewer">
                  <div className="panel mt-2 px-2 sm:px-3">
                    <ActionRows items={needs.slice(NEEDS_VISIBLE)} opportunities={opportunities} now={now} editable={editable} />
                  </div>
                </Disclose>
              ) : null}
            </section>
          ) : (
            <section aria-label="Needs you now">
              <div className="panel p-6">
                <h2 className="t-title">You are all caught up.</h2>
                <p className="mt-2 max-w-[44ch] text-ink-2">
                  {next ? <>Next up: {summaryLine(next, now)} with {next.company}.</> : "New emails and deadlines will appear here the moment they arrive."}
                </p>
              </div>
            </section>
          )}

          {briefing.comingUp.length > 0 ? (
            <section aria-label="Coming up">
              <SectionHead title="Coming up" count={briefing.comingUp.length}>
                <Link href={pipelineHref} className="link t-meta">
                  View pipeline
                </Link>
              </SectionHead>
              <div className="panel mt-3 px-2 sm:px-3">
                <ScheduleRows items={briefing.comingUp.slice(0, 3)} now={now} />
                {briefing.comingUp.length > 3 ? (
                  <Disclose className="mb-3 mt-1 px-2" summary={`${briefing.comingUp.length - 3} later`} openSummary="Show fewer">
                    <ScheduleRows items={briefing.comingUp.slice(3)} now={now} />
                  </Disclose>
                ) : null}
              </div>
            </section>
          ) : null}

          {briefing.waiting.length > 0 ? (
            <Disclose summary={`${briefing.waiting.length} waiting on replies`} openSummary="Hide waiting">
              <p className="t-meta mb-1 mt-3 text-ink-3">Applications with no reply yet. Only worth a nudge if you want one.</p>
              <ul className="list">
                {briefing.waiting.map((a) => (
                  <WaitingRow key={a.id} item={a} editable={editable} />
                ))}
              </ul>
            </Disclose>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4" aria-label="State of things">
          <PipelineCard opportunities={opportunities} pipelineHref={pipelineHref} />
          <RecentCard opportunities={opportunities} now={now} activityHref={activityHref} />
          {toCheck > 0 ? (
            <section aria-label="Review" className="panel p-4">
              <p className="font-medium tracking-tight">
                <span className="tnum">{toCheck}</span> {toCheck === 1 ? "needs" : "need"} review
              </p>
              <p className="t-meta mt-1 text-ink-2">We are not sure about {toCheck === 1 ? "this one" : "these"}. The most important first.</p>
              <Link href={checkHref} className="btn-soft mt-3">
                Review
              </Link>
            </section>
          ) : null}
          {updated ? <p className="t-meta tnum px-1 text-ink-3">Updated {updated}</p> : null}
        </aside>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Activity */

function dayGroupLabel(now: Date, date: Date) {
  const d = daysBetween(now, date);
  if (d === 0) return "Today";
  if (d === -1) return "Yesterday";
  if (d > -7) return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(date.getFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }) });
}

/** Everything that happened across your recruiting, newest first, written as plain sentences. */
export function ActivityStream({ opportunities, now }: { opportunities: Opportunity[]; now: Date }) {
  const entries = opportunities
    .flatMap((o) => o.events.map((e) => ({ opp: o, event: e })))
    .sort((a, b) => b.event.occurredAt.getTime() - a.event.occurredAt.getTime())
    .slice(0, 160);

  const groups: Array<{ label: string; items: typeof entries }> = [];
  for (const entry of entries) {
    const label = dayGroupLabel(now, entry.event.occurredAt);
    const group = groups[groups.length - 1];
    if (group?.label === label) group.items.push(entry);
    else groups.push({ label, items: [entry] });
  }

  const renderGroup = (group: (typeof groups)[number]) => (
    <section key={group.label + group.items[0].event.gmailMessageId} className="grid gap-x-10 py-6 sm:grid-cols-[8rem_1fr]">
      <h2 className="t-meta pt-[0.3rem] text-ink-3">{group.label}</h2>
      <ul className="list">
        {group.items.map(({ opp, event }) => (
          <li key={event.gmailMessageId}>
            <div className="row !py-2.5">
              <OpenOpportunity opportunityKey={opp.key} className="row-link min-w-0 truncate">
                <span className="font-medium tracking-tight">{opp.company}</span>
                <span className="text-ink-2"> {EVENT_LABEL[event.type].replace(/^./, (c) => c.toLowerCase())}</span>
              </OpenOpportunity>
              <span className="t-meta hidden max-w-[16rem] shrink truncate text-ink-3 sm:block">{opp.role ?? ""}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  const first = groups.slice(0, 6);
  const rest = groups.slice(6);
  return (
    <div className="divide-y divide-line border-t border-line">
      {first.map(renderGroup)}
      {rest.length > 0 ? (
        <div className="py-5">
          <Disclose summary="Show earlier activity" openSummary="Show less">
            <div className="divide-y divide-line">{rest.map(renderGroup)}</div>
          </Disclose>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- Opportunity page */

export function EventEditor({ event, compact = false }: { event: EffectiveEvent; compact?: boolean }) {
  return (
    <form action={editEventAction} className="grid gap-4 pb-1 pt-5 sm:grid-cols-2">
      <input type="hidden" name="eventId" value={event.id} />
      <label className="field">
        What happened
        <select name="type" defaultValue={event.type} className="input">
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t} className="text-black">
              {EVENT_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Company
        <input name="company" defaultValue={event.company ?? ""} required className="input" />
      </label>
      <label className="field">
        Role
        <input name="role" defaultValue={event.role ?? ""} className="input" />
      </label>
      <label className="field">
        Date or deadline
        <input name="eventDate" type="datetime-local" defaultValue={toInputValue(event.eventDate)} className="input" />
      </label>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button type="submit" className="btn-primary">
          Save
        </button>
        {compact ? null : (
          <>
            <button type="submit" formAction={confirmEventAction} formNoValidate className="link-quiet">
              Looks right
            </button>
            <button type="submit" formAction={ignoreEventAction} className="link-quiet">
              Not recruiting, hide it
            </button>
          </>
        )}
        {event.corrected ? (
          <button type="submit" formAction={resetEventAction} className="link-quiet">
            Undo my edits
          </button>
        ) : null}
      </div>
    </form>
  );
}

function gapLabel(days: number) {
  if (days < 2) return null;
  if (days < 14) return `${days} days later`;
  if (days < 60) return `${Math.round(days / 7)} weeks later`;
  return `${Math.round(days / 30)} months later`;
}

function TimelineEntry({ item, previous, now, editable }: { item: ReturnType<typeof annotateTimeline>[number]; previous?: ReturnType<typeof annotateTimeline>[number]; now: Date; editable: boolean }) {
  const { event, label, major, superseded, current } = item;
  const upcoming = event.eventDate ? daysBetween(now, event.eventDate) >= 0 : false;
  const struck = superseded ? "text-ink-3 line-through decoration-[var(--line-strong)]" : "";
  const gap = previous ? gapLabel(Math.round((event.occurredAt.getTime() - previous.event.occurredAt.getTime()) / 86_400_000)) : null;
  return (
    <>
      {gap ? <li aria-hidden className="tl-gap">{gap}</li> : null}
      <li className="group relative grid grid-cols-[5.5rem_1fr] gap-x-0 py-3">
        <span className="tl-marker" data-major={major} data-now={current && upcoming} aria-hidden />
        <p className="t-meta tnum whitespace-nowrap pt-[0.2rem] text-ink-3">{shortDay(event.occurredAt)}</p>
        <div className="min-w-0 pl-8 sm:pr-28">
          <p className={`${major ? "font-medium tracking-tight" : "text-ink-2"} ${struck}`}>
            {label}
            {event.corrected ? <span className="t-meta ml-2 font-normal text-ink-3 no-underline">edited by you</span> : null}
            {!event.corrected && event.confidence < 0.6 ? <span className="t-meta ml-2 font-normal text-ink-3">not sure about this one</span> : null}
          </p>
          {event.eventDate ? (
            <p className={`mt-0.5 tnum ${struck}`}>
              {event.dateKind === "deadline" ? "Due " : ""}
              {formatFloating(event.eventDate, event.eventDateHasTime)}
              {current && upcoming ? <span className="chip ml-3 no-underline">Next</span> : null}
            </p>
          ) : null}
          <p className="t-meta mt-0.5 truncate text-ink-3">
            {event.outbound ? "From you" : event.senderName || event.senderDomain}: {event.subject}
          </p>
        </div>
        {editable ? (
          <EventTools emailHref={gmailThreadUrl(event.gmailThreadId)}>
            <EventEditor event={event} />
          </EventTools>
        ) : null}
      </li>
    </>
  );
}

/** How it got here, in dates: the stages reached, each with the day it was first reached, and where it stands now. */
function MilestoneTrack({ opportunity }: { opportunity: Opportunity }) {
  const ms = stageMilestones(opportunity);
  const last = Math.max(0, ...ms.map((m, i) => (m.reached ? i : 0)));
  return (
    <ol className="jl mt-4" aria-label="How it got here">
      <span className="jl-track" aria-hidden />
      {last > 0 ? <span className="jl-fill" style={{ width: `${last * 20}%` }} aria-hidden /> : null}
      {ms.map((m) => (
        <li key={m.stage} className="jl-col" aria-current={m.current ? "step" : undefined}>
          <i className="jl-dot" data-reached={m.reached} data-current={m.current} aria-hidden />
          <span className={`mt-2 block whitespace-nowrap text-[0.6875rem] leading-tight sm:text-[0.75rem] ${m.current ? "font-semibold text-ink" : m.reached ? "text-ink-2" : "text-ink-3"}`}>{STAGE_LABEL[m.stage]}</span>
          <span className="tnum mt-0.5 block text-[0.6875rem] text-ink-3">{m.at ? shortDay(m.at) : m.reached ? "" : ""}</span>
        </li>
      ))}
    </ol>
  );
}

/** The canonical memory of one recruiting relationship: where it stands and what is next, then every message in order. */
export function OpportunityHistory({ opportunity, now, editable }: { opportunity: Opportunity; now: Date; editable: boolean }) {
  const items = annotateTimeline(opportunity.events);
  const next = nextMoment(opportunity, now);
  const people = peopleFor(opportunity);
  const since = stageSince(opportunity);
  const first = opportunity.events[0];
  const latestInbound = [...opportunity.events].reverse().find((e) => !e.outbound);
  const closedNote =
    opportunity.status === "closed"
      ? opportunity.outcome === "rejected"
        ? "Closed after a rejection"
        : opportunity.outcome === "offer"
          ? "Closed with an offer"
          : opportunity.outcome === "withdrawn"
            ? "Closed after you withdrew"
            : "Closed"
      : null;

  return (
    <div>
      <header className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <EntityMark opportunity={opportunity} size="lg" />
          <div className="min-w-0">
            <h1 className="t-display break-words">{opportunity.company}</h1>
            <p className="t-lead mt-2 text-ink-2">{opportunity.role ?? "No role detected"}</p>
            {entityState(opportunity) !== "known" ? (
              <p className="t-meta mt-2 text-ink-3">{entityState(opportunity) === "likely" ? "We think this is the right company, but the evidence is weak. Correct it from the history if it is wrong." : "We could not tell which company this is."}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        <span className="pill" data-tone={opportunity.status === "closed" ? "plain" : opportunity.stage === "offer" ? "ok" : "accent"}>
          {opportunity.status === "closed" ? "Closed" : STAGE_LABEL[opportunity.stage]}
        </span>
        {editable ? (
          <Menu label="Options for this opportunity">
            <form action={setOpportunityStatusAction}>
              <input type="hidden" name="key" value={opportunity.key} />
              <input type="hidden" name="status" value={opportunity.status === "closed" ? "active" : "closed"} />
              <button type="submit" className="menu-item" role="menuitem">
                {opportunity.status === "closed" ? "Reopen" : "Mark as closed"}
              </button>
            </form>
          </Menu>
        ) : null}
        </div>
      </header>

      <section aria-label="Where this stands" className="panel mt-8 grid gap-x-10 gap-y-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <p className="t-meta text-ink-3">How it got here</p>
          <MilestoneTrack opportunity={opportunity} />
          <p className="mt-4 font-medium tracking-tight">{closedNote ?? `${STAGE_LABEL[opportunity.stage]} since ${shortDay(since)}`}</p>
          <p className="t-meta mt-0.5 text-ink-2">
            Applied {relativeDay(now, first.occurredAt)}
            {opportunity.status === "active" ? `, in ${STAGE_LABEL[opportunity.stage]} for ${Math.max(0, -daysBetween(now, since))} days` : ""}
          </p>
        </div>
        <div className="space-y-5 md:border-l md:border-line md:pl-10">
          {next ? (
            <div>
              <p className="t-meta text-ink-3">{next.label}</p>
              <p className="mt-0.5 font-medium tnum">{formatWhen(next.date, next.hasTime).replace(" at ", " · ")}</p>
              <p className="t-meta text-ink-2">{relativeDay(now, next.date)}</p>
            </div>
          ) : (
            <div>
              <p className="t-meta text-ink-3">Next</p>
              <p className="mt-0.5 text-ink-2">Nothing scheduled.</p>
            </div>
          )}
          {people.length > 0 ? (
            <div>
              <p className="t-meta text-ink-3">People</p>
              <p className="mt-0.5">{people.join(", ")}</p>
            </div>
          ) : null}
          {editable && latestInbound ? (
            <a className="link-quiet inline-block" href={gmailThreadUrl(latestInbound.gmailThreadId)} target="_blank" rel="noreferrer">
              Open latest email
            </a>
          ) : null}
        </div>
      </section>

      <section aria-label="History" className="mt-10">
        <h2 className="t-heading">
          History <span className="tnum ml-1 font-normal text-ink-3">{items.length}</span>
        </h2>
        <ol className="tl mt-3" aria-label="History">
          {items.map((item, i) => (
            <TimelineEntry key={item.event.gmailMessageId} item={item} previous={i > 0 ? items[i - 1] : undefined} now={now} editable={editable} />
          ))}
        </ol>
      </section>
    </div>
  );
}
