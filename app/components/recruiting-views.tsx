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
import { Menu } from "@/app/components/menu";
import {
  buildBriefing,
  describeAction,
  type RecentChange,
} from "@/lib/recruiting/briefing";
import {
  EVENT_LABEL,
  STAGE_LABEL,
  daysBetween,
  formatFloating,
  gmailThreadUrl,
  relativeDay,
  toInputValue,
} from "@/lib/recruiting/format";
import {
  EVENT_TYPES,
  STAGES,
  type ActionItem,
  type EffectiveEvent,
  type EventType,
  type Opportunity,
  type Stage,
} from "@/lib/recruiting/types";

const oppHref = (base: string, key: string) => `${base}/${encodeURIComponent(key)}`;

/* ------------------------------------------------------------------ Today */

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="flex items-baseline gap-2 text-[0.9375rem] font-semibold tracking-tight">
        {title}
        {count !== undefined ? <span className="tnum font-normal text-ink-3">{count}</span> : null}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ActionMenu({
  item,
  basePath,
  editable,
  lean = false,
  align = "right",
}: {
  item: ActionItem;
  basePath: string;
  editable: boolean;
  /** Omit "Open email" when the primary button already opens it. */
  lean?: boolean;
  align?: "left" | "right";
}) {
  return (
    <Menu label={`More for ${item.company}`} align={align}>
      <Link className="menu-item" href={oppHref(basePath, item.opportunityKey)} role="menuitem">
        View history
      </Link>
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

/** The one thing that matters most, set large. Everything below it is quieter. */
function Hero({ item, now, basePath, editable }: { item: ActionItem; now: Date; basePath: string; editable: boolean }) {
  const copy = describeAction(item, now);
  const primaryHref = editable && item.sourceThreadId ? gmailThreadUrl(item.sourceThreadId) : oppHref(basePath, item.opportunityKey);
  return (
    <section className="mt-10 border-t border-line pt-10">
      <h2 className="t-title">{copy.headline}</h2>
      {item.role ? <p className="t-lead mt-1.5 text-ink-2">{item.role}</p> : null}
      {copy.when ? (
        <p className="t-lead mt-5 tnum">
          {copy.when}
          <span className={`ml-2 ${copy.critical ? "text-signal" : "text-ink-3"}`}>{copy.relative}</span>
        </p>
      ) : (
        <p className="t-lead mt-5 text-ink-2">
          {copy.critical ? (
            <>
              <span className="text-signal">{item.reason.split(" — ")[0]}</span>
              {item.reason.includes(" — ") ? ` — ${item.reason.split(" — ").slice(1).join(" — ")}` : ""}
            </>
          ) : (
            item.reason
          )}
        </p>
      )}
      <div className="mt-7 flex items-center gap-4">
        <a
          className="btn-primary"
          href={primaryHref}
          {...(editable && item.sourceThreadId ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {editable ? copy.primaryLabel : "See the history"}
        </a>
        <ActionMenu item={item} basePath={basePath} editable={editable} lean align="left" />
      </div>
    </section>
  );
}

/** A row in "Also needs you" / "Coming up": what, for whom, and when. The whole row opens the history. */
function ActionRow({ item, now, basePath, editable }: { item: ActionItem; now: Date; basePath: string; editable: boolean }) {
  const copy = describeAction(item, now);
  // The date is already on the right, so the subline only repeats it when there is no date.
  const sub = copy.relative ? (item.role ?? "") : [item.role, item.reason].filter(Boolean).join(" · ");
  return (
    <li>
      <div className="row">
        <div className="min-w-0">
          <Link href={oppHref(basePath, item.opportunityKey)} className="row-link block font-medium tracking-tight">
            {copy.headline}
          </Link>
          {sub ? <p className="t-meta mt-0.5 truncate text-ink-2">{sub}</p> : null}
        </div>
        <div className="row-end shrink-0">
          {copy.relative ? (
            <span className={`row-time t-meta tnum ${copy.critical ? "text-signal" : "text-ink-3"}`}>{copy.relative}</span>
          ) : null}
          <div className="row-tools">
            <ActionMenu item={item} basePath={basePath} editable={editable} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** "Applied 19 days ago with no update" -> "19 days quiet": one short fact per row. */
function quietFor(reason: string) {
  const m = reason.match(/(\d+) days? ago/);
  return m ? `${m[1]} days quiet` : reason.replace(/ — consider.*$/, "");
}

/** Follow-up suggestions are deliberately the quietest thing on the page. */
function WaitingRow({ item, basePath, editable }: { item: ActionItem; basePath: string; editable: boolean }) {
  return (
    <li>
      <div className="row !py-2.5">
        <p className="min-w-0 truncate">
          <Link href={oppHref(basePath, item.opportunityKey)} className="row-link text-ink-2 transition-colors hover:text-ink">
            {item.company}
          </Link>
          {item.role ? <span className="t-meta text-ink-3"> {item.role}</span> : null}
        </p>
        <div className="row-end shrink-0">
          <span className="row-time t-meta tnum text-ink-3">{quietFor(item.reason)}</span>
          <div className="row-tools">
            <ActionMenu item={item} basePath={basePath} editable={editable} />
          </div>
        </div>
      </div>
    </li>
  );
}

function RecentRow({ change, now, basePath }: { change: RecentChange; now: Date; basePath: string }) {
  return (
    <li>
      <div className="row">
        <Link href={oppHref(basePath, change.opportunityKey)} className="row-link min-w-0 truncate">
          <span className="font-medium tracking-tight">{change.company}</span>
          <span className="text-ink-2"> · {change.label}</span>
        </Link>
        <span className="t-meta shrink-0 text-ink-3">{relativeDay(now, change.when)}</span>
      </div>
    </li>
  );
}

const QUIET_VISIBLE = 4;

export function TodayBriefing({
  opportunities,
  actions,
  now,
  basePath,
  editable,
  greeting,
}: {
  opportunities: Opportunity[];
  actions: ActionItem[];
  now: Date;
  basePath: string;
  editable: boolean;
  greeting: React.ReactNode;
}) {
  const briefing = buildBriefing(opportunities, actions, now);
  const [hero, ...otherNeeds] = briefing.needsYou;
  const visibleWaiting = briefing.waiting.slice(0, QUIET_VISIBLE);
  const hiddenWaiting = briefing.waiting.slice(QUIET_VISIBLE);

  return (
    <div>
      {greeting}

      {hero ? (
        <Hero item={hero} now={now} basePath={basePath} editable={editable} />
      ) : (
        <p className="t-lead mt-8 max-w-[34ch] text-ink-2">
          Nothing is waiting on you. New emails and deadlines show up here as they arrive.
        </p>
      )}

      {otherNeeds.length > 0 ? (
        <Section title="Also needs you" count={otherNeeds.length}>
          <ul className="list">
            {otherNeeds.map((a) => (
              <ActionRow key={a.id} item={a} now={now} basePath={basePath} editable={editable} />
            ))}
          </ul>
        </Section>
      ) : null}

      {briefing.comingUp.length > 0 ? (
        <Section title="Coming up" count={briefing.comingUp.length}>
          <ul className="list">
            {briefing.comingUp.map((a) => (
              <ActionRow key={a.id} item={a} now={now} basePath={basePath} editable={editable} />
            ))}
          </ul>
        </Section>
      ) : null}

      {briefing.recent.length > 0 ? (
        <Section title="Recently changed">
          <ul className="list">
            {briefing.recent.map((c) => (
              <RecentRow key={c.opportunityKey} change={c} now={now} basePath={basePath} />
            ))}
          </ul>
        </Section>
      ) : null}

      {briefing.waiting.length > 0 ? (
        <Section title="Waiting" count={briefing.waiting.length}>
          <p className="t-meta -mt-0.5 mb-1 text-ink-3">Applications with no reply yet. Only worth a nudge if you want one.</p>
          <ul className="list">
            {visibleWaiting.map((a) => (
              <WaitingRow key={a.id} item={a} basePath={basePath} editable={editable} />
            ))}
          </ul>
          {hiddenWaiting.length > 0 ? (
            <Disclose className="mt-2" summary={`Show ${hiddenWaiting.length} more`} openSummary="Show fewer">
              <ul className="list mt-2">
                {hiddenWaiting.map((a) => (
                  <WaitingRow key={a.id} item={a} basePath={basePath} editable={editable} />
                ))}
              </ul>
            </Disclose>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Pipeline */

/** The last thing that actually moved the process, not a reply or a generic update. */
function lastMeaningful(opp: Opportunity): { label: string; at: Date; scheduled: Date | null } {
  const quiet = new Set<EventType>(["user_reply", "status_update", "follow_up"]);
  const event = [...opp.events].reverse().find((e) => !quiet.has(e.type)) ?? opp.events[opp.events.length - 1];
  return {
    label: EVENT_LABEL[event.type],
    at: event.occurredAt,
    scheduled: event.type === "interview_scheduled" ? event.eventDate : null,
  };
}

function OpportunityRow({ opp, now, basePath }: { opp: Opportunity; now: Date; basePath: string }) {
  const last = lastMeaningful(opp);
  const upcoming = last.scheduled && daysBetween(now, last.scheduled) >= 0;
  return (
    <li>
      <div className="row">
        <div className="min-w-0">
          <Link href={oppHref(basePath, opp.key)} className="row-link block truncate font-medium tracking-tight">
            {opp.company}
          </Link>
          <p className={`t-meta mt-0.5 truncate ${opp.role ? "text-ink-2" : "text-ink-3"}`}>{opp.role ?? "No role detected"}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-meta text-ink-2">{last.label}</p>
          <p className="t-meta tnum text-ink-3">
            {upcoming && last.scheduled ? formatFloating(last.scheduled, true) : relativeDay(now, last.at)}
          </p>
        </div>
      </div>
    </li>
  );
}

export function PipelineList({
  opportunities,
  now,
  basePath,
}: {
  opportunities: Opportunity[];
  now: Date;
  basePath: string;
}) {
  const active = opportunities.filter((o) => o.status === "active");
  const closed = opportunities.filter((o) => o.status === "closed");
  // Most advanced first: the offer you're weighing matters more than the application you sent last week.
  const order = STAGES.filter((s) => s !== "closed").reverse() as Stage[];
  const groups = order
    .map((stage) => ({ stage, rows: active.filter((o) => o.stage === stage) }))
    .filter((g) => g.rows.length > 0);

  if (opportunities.length === 0) {
    return (
      <p className="t-lead max-w-[36ch] text-ink-2">
        No recruiting activity found yet. Refresh to read your inbox, or check back after your next application.
      </p>
    );
  }

  return (
    <div>
      {groups.map(({ stage, rows }) => (
        <section key={stage} className="mt-12 first:mt-0">
          <h2 className="flex items-baseline gap-2 text-[0.9375rem] font-semibold tracking-tight">
            {STAGE_LABEL[stage]}
            <span className="tnum font-normal text-ink-3">{rows.length}</span>
          </h2>
          <ul className="list mt-2">
            {rows.map((o) => (
              <OpportunityRow key={o.key} opp={o} now={now} basePath={basePath} />
            ))}
          </ul>
        </section>
      ))}
      {closed.length > 0 ? (
        <section className="mt-12">
          <h2 className="flex items-baseline gap-2 text-[0.9375rem] font-semibold tracking-tight text-ink-2">
            Closed
            <span className="tnum font-normal text-ink-3">{closed.length}</span>
          </h2>
          <Disclose className="mt-2" summary="Show closed" openSummary="Hide closed">
            <ul className="list mt-2">
              {closed.map((o) => (
                <OpportunityRow key={o.key} opp={o} now={now} basePath={basePath} />
              ))}
            </ul>
          </Disclose>
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Timeline */

const MINOR: EventType[] = ["user_reply", "status_update", "follow_up"];

function StageTrack({ stage, outcome }: { stage: Stage; outcome: Opportunity["outcome"] }) {
  const steps = STAGES.filter((s) => s !== "closed");
  const index = steps.indexOf(stage === "closed" ? "applied" : stage);
  return (
    <ol className="flex items-center gap-x-5 text-sm" aria-label="Stage">
      {steps.map((s, i) => {
        const reached = stage !== "closed" && i <= index;
        const current = stage !== "closed" && i === index;
        return (
          <li
            key={s}
            aria-current={current ? "step" : undefined}
            className={current ? "font-semibold text-ink" : reached ? "text-ink-2" : "text-ink-3/70"}
          >
            {STAGE_LABEL[s]}
          </li>
        );
      })}
      {stage === "closed" ? (
        <li className="font-semibold text-ink">
          {outcome === "rejected" ? "Rejected" : outcome === "withdrawn" ? "Withdrawn" : "Closed"}
        </li>
      ) : null}
    </ol>
  );
}

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

function shortDay(date: Date) {
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function TimelineEntry({ event, editable }: { event: EffectiveEvent; editable: boolean }) {
  const minor = MINOR.includes(event.type);
  return (
    <li className="group relative grid grid-cols-[4.5rem_1fr] gap-x-6 pb-8 last:pb-0">
      <span
        className="absolute -left-px top-[0.62rem] h-[7px] w-[7px] -translate-x-1/2 rounded-full"
        style={{ background: minor ? "var(--line-strong)" : "var(--ink)" }}
        aria-hidden
      />
      <p className="t-meta tnum whitespace-nowrap pl-6 pt-[0.3rem] text-ink-3">{shortDay(event.occurredAt)}</p>
      <div className="min-w-0 sm:pr-28">
        <p className={minor ? "text-ink-2" : "font-medium tracking-tight"}>
          {EVENT_LABEL[event.type]}
          {event.corrected ? <span className="t-meta ml-2 font-normal text-ink-3">edited by you</span> : null}
          {!event.corrected && event.confidence < 0.6 ? (
            <span className="t-meta ml-2 font-normal text-ink-3">not sure about this one</span>
          ) : null}
        </p>
        {event.eventDate ? (
          <p className="mt-0.5 tnum">
            {event.dateKind === "deadline" ? "Due " : ""}
            {formatFloating(event.eventDate, event.eventDateHasTime)}
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

export function OpportunityHistory({ opportunity, editable }: { opportunity: Opportunity; editable: boolean }) {
  const closedNote =
    opportunity.status === "closed"
      ? opportunity.outcome === "rejected"
        ? "Closed after a rejection."
        : opportunity.outcome === "offer"
          ? "Closed with an offer."
          : opportunity.outcome === "withdrawn"
            ? "Closed after you withdrew."
            : "Closed."
      : null;
  return (
    <div>
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="t-display break-words">{opportunity.company}</h1>
          <p className="t-lead mt-2 text-ink-2">{opportunity.role ?? "Role not detected"}</p>
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

      <div className="mt-8">
        <StageTrack stage={opportunity.stage} outcome={opportunity.outcome} />
        {closedNote ? <p className="t-meta mt-2 text-ink-3">{closedNote}</p> : null}
      </div>

      <ol className="relative mt-14 ml-1 border-l border-line" aria-label="History">
        {opportunity.events.map((event) => (
          <TimelineEntry key={event.gmailMessageId} event={event} editable={editable} />
        ))}
      </ol>
    </div>
  );
}
