import Link from "next/link";
import {
  dismissActionAction,
  editEventAction,
  ignoreEventAction,
  resetEventAction,
  setOpportunityStatusAction,
} from "@/app/actions";
import {
  EVENT_LABEL,
  STAGE_LABEL,
  formatDay,
  formatFloating,
  gmailThreadUrl,
  toInputValue,
} from "@/lib/recruiting/format";
import {
  EVENT_TYPES,
  STAGES,
  type ActionItem,
  type EffectiveEvent,
  type Opportunity,
  type Stage,
} from "@/lib/recruiting/types";

const BUCKETS: Array<{ id: ActionItem["bucket"]; title: string; tone: string }> = [
  { id: "overdue", title: "Overdue", tone: "text-red-700 dark:text-red-400" },
  { id: "today", title: "Today", tone: "text-foreground" },
  { id: "soon", title: "This week", tone: "text-foreground" },
  { id: "worth_a_look", title: "Worth a look", tone: "text-zinc-500" },
];

const oppHref = (base: string, key: string) => `${base}/${encodeURIComponent(key)}`;

const quietButton =
  "appearance-none rounded-md border border-zinc-300 bg-transparent px-2.5 py-1 text-xs font-medium transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function TodayView({
  actions,
  basePath,
  editable,
}: {
  actions: ActionItem[];
  basePath: string;
  editable: boolean;
}) {
  if (actions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
        <p className="font-medium">Nothing needs you right now.</p>
        <p className="mt-1 text-sm text-zinc-500">
          No open deadlines, interviews or unanswered recruiters. Check the Pipeline for the full picture.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {BUCKETS.map((bucket) => {
        const items = actions.filter((a) => a.bucket === bucket.id);
        if (items.length === 0) return null;
        return (
          <section key={bucket.id}>
            <h2 className={`text-xs font-semibold uppercase tracking-wide ${bucket.tone}`}>
              {bucket.title} · {items.length}
            </h2>
            <ul className="mt-3 space-y-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                        {item.company}
                        {item.role ? ` · ${item.role}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.reason}
                        {item.due ? ` (${formatFloating(item.due, item.dueHasTime)})` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Link className={quietButton} href={oppHref(basePath, item.opportunityKey)}>Timeline</Link>
                      {item.sourceThreadId && editable ? (
                        <a className={quietButton} href={gmailThreadUrl(item.sourceThreadId)} target="_blank" rel="noreferrer">Open email</a>
                      ) : null}
                      {editable ? (
                        <form action={dismissActionAction}>
                          <input type="hidden" name="actionId" value={item.id} />
                          <button type="submit" className={quietButton}>Done</button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ago(date: Date, now: Date) {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function PipelineView({
  opportunities,
  actions,
  basePath,
  now,
}: {
  opportunities: Opportunity[];
  actions: ActionItem[];
  basePath: string;
  now: Date;
}) {
  const active = opportunities.filter((o) => o.status === "active");
  const closed = opportunities.filter((o) => o.status === "closed");
  const nextAction = (key: string) => actions.find((a) => a.opportunityKey === key);
  const stageOrder = [...STAGES].filter((s) => s !== "closed").reverse() as Stage[];

  const Row = ({ opp }: { opp: Opportunity }) => {
    const next = nextAction(opp.key);
    return (
      <li>
        <Link
          href={oppHref(basePath, opp.key)}
          className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {opp.company}
              {opp.needsReview ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">Check details</span> : null}
            </p>
            <p className="text-xs text-zinc-500">{opp.role ?? "Role unknown"} · last activity {ago(opp.lastActivityAt, now)}</p>
          </div>
          {next ? <span className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400">{next.title}</span> : null}
          {!next && opp.outcome ? <span className="shrink-0 text-xs text-zinc-500">{opp.outcome === "rejected" ? "Rejected" : opp.outcome === "offer" ? "Offer" : "Withdrawn"}</span> : null}
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {active.length} active · {closed.length} closed · {opportunities.length} total
      </p>
      {stageOrder.map((stage) => {
        const rows = active.filter((o) => o.stage === stage);
        if (rows.length === 0) return null;
        return (
          <section key={stage}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{STAGE_LABEL[stage]} · {rows.length}</h2>
            <ul className="mt-3 space-y-2">{rows.map((o) => <Row key={o.key} opp={o} />)}</ul>
          </section>
        );
      })}
      {closed.length > 0 ? (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Closed · {closed.length}</h2>
          <ul className="mt-3 space-y-2">{closed.map((o) => <Row key={o.key} opp={o} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function StageTrack({ stage }: { stage: Stage }) {
  const steps = STAGES.filter((s) => s !== "closed");
  const index = steps.indexOf(stage === "closed" ? "applied" : stage);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s} className={`rounded-full px-2.5 py-1 ${i <= index && stage !== "closed" ? "bg-foreground text-background" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"}`}>
          {STAGE_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

function EventEditor({ event }: { event: EffectiveEvent }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-zinc-500">Something wrong?</summary>
      <form action={editEventAction} className="mt-2 grid gap-2 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800 sm:grid-cols-2">
        <input type="hidden" name="eventId" value={event.id} />
        <label className="grid gap-1">Event type
          <select name="type" defaultValue={event.type} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            {EVENT_TYPES.map((t) => <option key={t} value={t} className="text-black">{EVENT_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Company
          <input name="company" defaultValue={event.company ?? ""} required className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="grid gap-1">Role
          <input name="role" defaultValue={event.role ?? ""} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="grid gap-1">Deadline / date (blank = none)
          <input name="eventDate" type="datetime-local" defaultValue={toInputValue(event.eventDate)} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className={quietButton}>Save fix</button>
          <button type="submit" formAction={ignoreEventAction} className={quietButton}>Not recruiting — hide</button>
          {event.corrected ? <button type="submit" formAction={resetEventAction} className={quietButton}>Undo my edits</button> : null}
        </div>
      </form>
    </details>
  );
}

export function Timeline({ opportunity, editable }: { opportunity: Opportunity; editable: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{opportunity.company}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{opportunity.role ?? "Role not detected"}</p>
        </div>
        {editable ? (
          <form action={setOpportunityStatusAction}>
            <input type="hidden" name="key" value={opportunity.key} />
            <input type="hidden" name="status" value={opportunity.status === "closed" ? "active" : "closed"} />
            <button type="submit" className={quietButton}>{opportunity.status === "closed" ? "Reopen" : "Mark closed"}</button>
          </form>
        ) : null}
      </div>

      <div className="mt-5">
        <StageTrack stage={opportunity.stage} />
        {opportunity.status === "closed" ? (
          <p className="mt-2 text-xs text-zinc-500">
            Closed{opportunity.outcome === "rejected" ? " — rejected" : opportunity.outcome === "offer" ? " — offer" : opportunity.outcome === "withdrawn" ? " — you withdrew" : ""}.
          </p>
        ) : null}
      </div>

      <ol className="mt-8 space-y-0 border-l border-zinc-200 pl-6 dark:border-zinc-800">
        {opportunity.events.map((event) => (
          <li key={event.gmailMessageId} className="relative pb-6 last:pb-0">
            <span className={`absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full ${event.outbound ? "bg-zinc-400" : "bg-foreground"}`} />
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{EVENT_LABEL[event.type]}</p>
              {event.corrected ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">You edited</span> : null}
              {!event.corrected && event.confidence < 0.6 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">Low confidence</span> : null}
            </div>
            <p className="text-xs text-zinc-500">{formatDay(event.occurredAt)} · {event.outbound ? "You" : event.senderName || event.senderDomain}</p>
            {event.eventDate ? (
              <p className="mt-1 text-sm">
                {event.dateKind === "deadline" ? "Deadline" : "Scheduled"}: {formatFloating(event.eventDate, event.eventDateHasTime)}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-zinc-500">&ldquo;{event.subject}&rdquo;{editable ? <> · <a className="underline" href={gmailThreadUrl(event.gmailThreadId)} target="_blank" rel="noreferrer">Open email</a></> : null}</p>
            {editable ? <EventEditor event={event} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
