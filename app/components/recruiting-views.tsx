import Link from "next/link";
import {
  dismissActionAction,
  editEventAction,
  ignoreEventAction,
  resetEventAction,
  setOpportunityStatusAction,
} from "@/app/actions";
import { Disclose } from "@/app/components/disclose";
import { EventTools } from "@/app/components/event-tools";
import { JourneyLine } from "@/app/components/journey-line";
import { Menu } from "@/app/components/menu";
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
import { EVENT_TYPES, type ActionItem, type ActionKind, type EffectiveEvent, type Opportunity } from "@/lib/recruiting/types";

const fullHref = (base: string, key: string) => `${base}/${encodeURIComponent(key)}`;

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

const KIND_LABEL: Record<ActionKind, string> = {
  upcoming_interview: "Interview",
  assessment_deadline: "Assessment due",
  offer_decision: "Offer decision",
  schedule_interview: "Interview invitation",
  respond_recruiter: "Recruiter message",
  follow_up: "Follow up",
  check_in: "Check in",
};

/** The sentence under the date: where this came from, in words. Only when there is something true to say. */
function heroContext(opp: Opportunity | undefined, item: ActionItem) {
  if (!opp || item.kind !== "upcoming_interview") return null;
  const scheduled = [...opp.events].reverse().find((e) => e.type === "interview_scheduled");
  if (!scheduled) return null;
  const people = peopleFor(opp, 1);
  return `Confirmed ${shortDay(scheduled.occurredAt)}${people[0] ? ` by ${people[0]}` : ""}.`;
}

/**
 * The most important thing today. A tinted field (the one surface shift in the product), big type,
 * one primary action, and the journey line showing where this opportunity stands.
 */
function Hero({ item, opp, now, basePath, editable }: { item: ActionItem; opp?: Opportunity; now: Date; basePath: string; editable: boolean }) {
  const copy = describeAction(item, now);
  const context = heroContext(opp, item);
  const primaryHref = editable && item.sourceThreadId ? gmailThreadUrl(item.sourceThreadId) : fullHref(basePath, item.opportunityKey);
  const primaryLabel = copy.primaryLabel.replace("Open the ", "Open ").replace("the email", "email");
  return (
    <section className="hero" aria-label="Most important today">
      <div className="flex items-baseline justify-between gap-4">
        <p className="t-label text-ink-2">{item.company}</p>
        {copy.relative ? <p className={`t-label ${copy.critical ? "text-signal" : "text-accent"}`}>{copy.relative}</p> : null}
      </div>
      <h2 className="t-title mt-3.5">{item.role ?? copy.headline}</h2>
      <p className="t-lead mt-1 text-ink-2">{KIND_LABEL[item.kind]}</p>
      {copy.when ? (
        <p className="mt-5 text-[1.1875rem] font-medium leading-snug tracking-tight tnum sm:text-[1.375rem]">{copy.when.replace(" at ", " · ")}</p>
      ) : (
        <p className="mt-6 max-w-[34ch] text-[1.1875rem] leading-snug text-ink-2">
          {copy.critical ? <span className="text-signal">{item.reason.split(" — ")[0]}</span> : item.reason.split(" — ")[0]}
          {item.reason.includes(" — ") ? ` — ${item.reason.split(" — ").slice(1).join(" — ")}` : ""}
        </p>
      )}
      {context ? <p className="t-meta mt-2 text-ink-2">{context}</p> : null}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <a className="btn-primary" href={primaryHref} {...(editable && item.sourceThreadId ? { target: "_blank", rel: "noreferrer" } : {})}>
          {editable ? primaryLabel : "See the history"}
        </a>
        <OpenOpportunity opportunityKey={item.opportunityKey} className="link-quiet">
          View history →
        </OpenOpportunity>
        <ActionMenu item={item} editable={editable} lean align="left" />
      </div>
      {opp ? (
        <div className="mt-7 max-w-[28rem]">
          <JourneyLine stage={opp.stage} surface="tint" />
        </div>
      ) : null}
    </section>
  );
}

function EmptyHero() {
  return (
    <section className="hero" aria-label="Nothing needs you">
      <p className="t-label text-accent">All clear</p>
      <h2 className="t-title mt-4 max-w-[18ch]">Nothing is waiting on you.</h2>
      <p className="t-lead mt-2 max-w-[38ch] text-ink-2">New emails and deadlines will appear here the moment they arrive.</p>
    </section>
  );
}

function dayHeading(now: Date, due: Date | null, overdue: boolean) {
  if (due === null || overdue) return "Now";
  const d = daysBetween(now, due);
  if (d <= 0) return "Today";
  if (d === 1) return "Tomorrow";
  return due.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** Chronological agenda for the next week: things needing a reply first ("Now"), then by day. */
function Agenda({ items, now, editable }: { items: ActionItem[]; now: Date; editable: boolean }) {
  const sorted = [...items].sort((a, b) => {
    const ad = a.due && a.bucket !== "overdue" ? a.due.getTime() : -1;
    const bd = b.due && b.bucket !== "overdue" ? b.due.getTime() : -1;
    return ad - bd || b.priority - a.priority;
  });
  const rows = sorted.map((item, i) => {
    const heading = dayHeading(now, item.due, item.bucket === "overdue");
    const previous = i === 0 ? null : dayHeading(now, sorted[i - 1].due, sorted[i - 1].bucket === "overdue");
    return { item, heading, showHeading: heading !== previous };
  });
  return (
    <section>
      <SectionHead title="Coming up" count={items.length} />
      <ul className="list mt-2">
        {rows.map(({ item, heading, showHeading }) => {
          const copy = describeAction(item, now);
          return (
            <li key={item.id}>
              <div className="row !items-start !gap-4">
                <p className={`t-meta w-[5.25rem] shrink-0 pt-[0.2rem] ${heading === "Now" ? "font-semibold text-signal" : "text-ink-3"}`}>{showHeading ? heading : ""}</p>
                <div className="min-w-0 flex-1">
                  <OpenOpportunity opportunityKey={item.opportunityKey} className="row-link block font-medium tracking-tight">
                    {copy.headline}
                  </OpenOpportunity>
                  <p className="t-meta mt-0.5 truncate text-ink-2">{item.role ?? item.reason}</p>
                </div>
                <div className="row-end shrink-0 pt-[0.2rem]">
                  {item.due && item.dueHasTime ? (
                    <span className="row-time t-meta tnum text-ink-3">
                      {item.due.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" })}
                    </span>
                  ) : null}
                  <div className="row-tools">
                    <ActionMenu item={item} editable={editable} />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Where every active opportunity sits, as a thin distribution. Each row links to that stage. */
function Pulse({ opportunities, pipelineHref }: { opportunities: Opportunity[]; pipelineHref: string }) {
  const rows = pulse(opportunities);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const active = opportunities.filter((o) => o.status === "active").length;
  const closed = opportunities.length - active;
  return (
    <section aria-label="Recruiting pulse">
      <SectionHead title="Recruiting pulse" />
      <ul className="mt-4 space-y-3.5">
        {rows.map((r) => (
          <li key={r.stage}>
            <Link href={`${pipelineHref}?stage=${r.stage}`} className="group grid grid-cols-[5.75rem_1fr_1.75rem] items-center gap-3">
              <span className={`text-[0.9375rem] transition-colors group-hover:text-ink ${r.count === 0 ? "text-ink-3" : "text-ink-2"}`}>{STAGE_LABEL[r.stage]}</span>
              <span className="relative block h-[3px] rounded-full bg-[var(--line)]" aria-hidden>
                {r.count > 0 ? <span className="pulse-bar absolute inset-y-0 left-0 block" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} /> : null}
              </span>
              <span className={`tnum text-right text-[0.9375rem] ${r.count === 0 ? "text-ink-3" : "font-medium"}`}>{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="t-meta mt-5 text-ink-3">
        {active} active{closed > 0 ? `, ${closed} closed` : ""}
      </p>
    </section>
  );
}

/** A light event stream, not another task list. */
function Recent({ opportunities, now }: { opportunities: Opportunity[]; now: Date }) {
  const { recent } = buildBriefing(opportunities, [], now);
  if (recent.length === 0) return null;
  return (
    <section>
      <SectionHead title="Recently changed" />
      <ul className="list mt-2">
        {recent.map((c) => (
          <li key={c.opportunityKey}>
            <div className="row !px-0 !py-2.5" style={{ margin: 0 }}>
              <OpenOpportunity opportunityKey={c.opportunityKey} className="row-link min-w-0">
                <span className="block truncate font-medium tracking-tight">{c.company}</span>
                <span className="t-meta block truncate text-ink-2">{c.label}</span>
              </OpenOpportunity>
              <span className="t-meta shrink-0 text-ink-3">{relativeDay(now, c.when)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
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

const WAITING_VISIBLE = 5;

export function TodayComposition({
  opportunities,
  actions,
  now,
  basePath,
  pipelineHref,
  editable,
  greeting,
}: {
  opportunities: Opportunity[];
  actions: ActionItem[];
  now: Date;
  basePath: string;
  pipelineHref: string;
  editable: boolean;
  greeting: React.ReactNode;
}) {
  const briefing = buildBriefing(opportunities, actions, now);
  const [hero, ...otherNeeds] = briefing.needsYou;
  const agenda = [...otherNeeds, ...briefing.comingUp];
  const visibleWaiting = briefing.waiting.slice(0, WAITING_VISIBLE);
  const hiddenWaiting = briefing.waiting.slice(WAITING_VISIBLE);
  const heroOpp = hero ? opportunities.find((o) => o.key === hero.opportunityKey) : undefined;

  return (
    <div>
      {greeting}
      <div className="today-grid mt-8">
        <div className="today-main space-y-12">
          {hero ? <Hero item={hero} opp={heroOpp} now={now} basePath={basePath} editable={editable} /> : <EmptyHero />}
          {agenda.length > 0 ? <Agenda items={agenda} now={now} editable={editable} /> : null}
        </div>

        <aside className="today-side space-y-12" aria-label="Overview">
          <Pulse opportunities={opportunities} pipelineHref={pipelineHref} />
          <Recent opportunities={opportunities} now={now} />
        </aside>

        {briefing.waiting.length > 0 ? (
          <section className="today-wait">
            <SectionHead title="Waiting" count={briefing.waiting.length} />
            <p className="t-meta mb-1 mt-1 text-ink-3">Applications with no reply yet. Only worth a nudge if you want one.</p>
            <ul className="list">
              {visibleWaiting.map((a) => (
                <WaitingRow key={a.id} item={a} editable={editable} />
              ))}
            </ul>
            {hiddenWaiting.length > 0 ? (
              <Disclose className="mt-3" summary={`Show ${hiddenWaiting.length} more`} openSummary="Show fewer">
                <ul className="list mt-1">
                  {hiddenWaiting.map((a) => (
                    <WaitingRow key={a.id} item={a} editable={editable} />
                  ))}
                </ul>
              </Disclose>
            ) : null}
          </section>
        ) : null}
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

function EventEditor({ event }: { event: EffectiveEvent }) {
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
        <button type="submit" formAction={ignoreEventAction} className="link-quiet">
          Not recruiting, hide it
        </button>
        {event.corrected ? (
          <button type="submit" formAction={resetEventAction} className="link-quiet">
            Undo my edits
          </button>
        ) : null}
      </div>
    </form>
  );
}

function TimelineEntry({ item, editable }: { item: ReturnType<typeof annotateTimeline>[number]; editable: boolean }) {
  const { event, label, major, superseded, current } = item;
  const struck = superseded ? "text-ink-3 line-through decoration-[var(--line-strong)]" : "";
  return (
    <li className="group relative grid grid-cols-[4.5rem_1fr] gap-x-6 pb-8 last:pb-0">
      <span
        className="absolute -left-px top-[0.62rem] h-[7px] w-[7px] -translate-x-1/2 rounded-full"
        style={{ background: !major ? "var(--line-strong)" : current ? "var(--accent)" : "var(--ink)", boxShadow: current ? "0 0 0 4px var(--accent-wash)" : "none" }}
        aria-hidden
      />
      <p className="t-meta tnum whitespace-nowrap pl-6 pt-[0.3rem] text-ink-3">{shortDay(event.occurredAt)}</p>
      <div className="min-w-0 sm:pr-28">
        <p className={`${major ? "font-medium tracking-tight" : "text-ink-2"} ${struck}`}>
          {label}
          {event.corrected ? <span className="t-meta ml-2 font-normal text-ink-3 no-underline">edited by you</span> : null}
          {!event.corrected && event.confidence < 0.6 ? <span className="t-meta ml-2 font-normal text-ink-3">not sure about this one</span> : null}
        </p>
        {event.eventDate ? (
          <p className={`mt-0.5 tnum ${struck}`}>
            {event.dateKind === "deadline" ? "Due " : ""}
            {formatFloating(event.eventDate, event.eventDateHasTime)}
            {current ? <span className="t-label ml-3 text-accent no-underline">Now</span> : null}
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
  );
}

/** The canonical memory of one recruiting relationship. */
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
        <div className="min-w-0">
          <h1 className="t-display break-words">{opportunity.company}</h1>
          <p className="t-lead mt-2 text-ink-2">{opportunity.role ?? "No role detected"}</p>
        </div>
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
      </header>

      <div className="mt-12 grid gap-x-20 gap-y-12 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <ol className="relative ml-1 border-l border-line" aria-label="History">
          {items.map((item) => (
            <TimelineEntry key={item.event.gmailMessageId} item={item} editable={editable} />
          ))}
        </ol>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Where this stands">
          <p className="t-label text-ink-3">Now</p>
          <div className="mt-5">
            <JourneyLine stage={opportunity.stage} surface="paper" />
          </div>
          <p className="mt-4 text-[1.0625rem] font-medium tracking-tight">
            {closedNote ?? `${STAGE_LABEL[opportunity.stage]} since ${shortDay(since)}`}
          </p>
          <p className="t-meta mt-0.5 text-ink-2">
            Applied {relativeDay(now, first.occurredAt)}
            {opportunity.status === "active" ? `, in ${STAGE_LABEL[opportunity.stage]} for ${Math.max(0, -daysBetween(now, since))} days` : ""}
          </p>
          {next ? (
            <div className="mt-6 border-t border-line pt-5">
              <p className="t-meta text-ink-3">{next.label}</p>
              <p className="mt-0.5 text-[1.0625rem] font-medium tnum">{formatWhen(next.date, next.hasTime).replace(" at ", " · ")}</p>
              <p className="t-meta mt-0.5 text-ink-2">{relativeDay(now, next.date)}</p>
            </div>
          ) : null}
          {people.length > 0 ? (
            <div className="mt-6 border-t border-line pt-5">
              <p className="t-meta text-ink-3">People</p>
              <p className="mt-0.5">{people.join(", ")}</p>
            </div>
          ) : null}
          {editable && latestInbound ? (
            <div className="mt-6 border-t border-line pt-5">
              <a className="link-quiet" href={gmailThreadUrl(latestInbound.gmailThreadId)} target="_blank" rel="noreferrer">
                Open latest email
              </a>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
