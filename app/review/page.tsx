import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/app/components/app-shell";
import { EventEditor } from "@/app/components/recruiting-views";
import { Triage } from "@/app/components/triage";
import { isDatabaseConfigured } from "@/lib/db";
import { toFloating } from "@/lib/recruiting/actions";
import { EVENT_NOUN, formatDay } from "@/lib/recruiting/format";
import { entityState } from "@/lib/recruiting/presentation";
import { buildAutonomousReview, type Handled } from "@/lib/recruiting/autonomy";
import { confirmEventAction } from "@/app/actions";
import { reviewOptions } from "@/lib/recruiting/product-config";
import { loadWorkspace } from "@/lib/recruiting/store";
import { isSampleUser } from "@/lib/gmail/sample";

export const metadata = { title: "Needs review · Opportunity Inbox" };

export default async function ReviewPage() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  const real = new Date();
  const now = toFloating(real);
  const workspace = await loadWorkspace(sub, real);
  const review = buildAutonomousReview(workspace.opportunities, undefined, workspace.possible, now, reviewOptions());
  const queue = review.asks;
  const updated = workspace.lastSyncedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sample = isSampleUser(sub);

  const items = queue.map((item) => ({
    id: item.event.id,
    company: item.company,
    role: item.role,
    opportunityKey: item.opportunityKey,
    possible: Boolean(item.possible),
    weak: Boolean(item.weak),
    tier: item.tier,
    why: item.why,
    date: formatDay(item.event.occurredAt),
    sentence: item.possible
      ? "We think this might be about a job or internship."
      : item.why === "Might be a rejection"
        ? `We think this might be a rejection. We read it as ${EVENT_NOUN[item.event.type]}.`
        : item.event.type === "offer" && ((k) => k === "mentorship" || k === "scholarship")(workspace.opportunities.find((o) => o.key === item.opportunityKey)?.kind)
          ? "We think you were accepted into this program."
          : `We think this is ${EVENT_NOUN[item.event.type]}.`,
    entity: item.possible ? (item.event.company ? "likely" : "unknown") : (workspace.opportunities.find((o) => o.key === item.opportunityKey) ? entityState(workspace.opportunities.find((o) => o.key === item.opportunityKey)!) : "unknown"),
    reasons: item.reasons,
    ask: item.ask,
    source: `${item.event.senderName || item.event.senderDomain}: ${item.event.subject}`,
    gmailThread: sample ? null : item.event.gmailThreadId,
  }));
  const row = (h: Handled) => ({ id: h.event.id, company: h.company, role: h.role, date: formatDay(h.event.occurredAt), source: `${h.event.senderName || h.event.senderDomain}: ${h.event.subject}`, headline: h.headline, why: h.why, kind: h.kind, gmailThread: sample ? null : h.event.gmailThreadId });
  const handledRows = review.handled.map(row), setAsideRows = review.setAside.map(row), unassignedRows = review.unassigned.map(row);
  const editors = Object.fromEntries(queue.map((item) => [item.event.id, <EventEditor key={item.event.id} event={item.event} compact />]));

  return (
    <AppShell active="review" user={session?.user} updated={updated} opportunities={workspace.opportunities} possible={workspace.possible} now={now} width="reading">
      <h1 className="t-display">Needs review</h1>
      <p className="t-lead mt-3 max-w-[46ch] text-ink-2">The things we are least sure about, the most important first. Each takes a few seconds.</p>
      <div className="mt-8">
        <Triage items={items} editors={editors} />
      </div>
      <Section title="Handled automatically" count={handledRows.length} note="Messages that sit in a journey and say what they say. A lower confidence alone is never a question; each line says why, and opening the opportunity lets you correct anything." rows={handledRows} />
      <Section title="Set aside" count={setAsideRows.length} note="Nothing in these messages states your own application, interview, assessment, offer or ending: campaigns, recommendations, notices, events, account mail and applications you started but did not submit. Kept, with the reason." rows={setAsideRows} />
      <Section title="Unassigned evidence" count={unassignedRows.length} note="These state something about your own process but could not be tied to one journey safely. They change nothing until they can be attached. If one is yours, you can add it." rows={unassignedRows} action />
    </AppShell>
  );
}

type Row = { id: string; company: string; role: string | null; date: string; source: string; headline: string; why: string; kind: string; gmailThread: string | null };
function Section({ title, count, note, rows, action }: { title: string; count: number; note: string; rows: Row[]; action?: boolean }) {
  if (count === 0) return null;
  const kinds = rows.reduce((m: Record<string, number>, r) => { m[r.headline] = (m[r.headline] ?? 0) + 1; return m; }, {});
  const shown = rows.slice(0, 60);
  return (
    <details className="mt-8">
      <summary className="link-quiet cursor-pointer">{title} · {count}</summary>
      <p className="t-meta mb-2 mt-3 max-w-[60ch] text-ink-3">{note}</p>
      {count > shown.length ? <p className="t-meta mb-2 text-ink-3">{Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(" · ")}. The {shown.length} most recent are listed.</p> : null}
      <ul className="list border-y border-line">
        {shown.map((r) => (
          <li key={r.id} className="py-3">
            <p className="font-medium tracking-tight">{r.company}{r.role ? ` · ${r.role}` : ""} <span className="t-meta tnum text-ink-3">{r.date}</span></p>
            <p className="t-meta truncate text-ink-3">{r.source}</p>
            <p className="t-meta mt-1 text-ink-2"><span className="chip">{r.headline}</span> {r.why}</p>
            {action ? (
              <form action={confirmEventAction} className="mt-2"><input type="hidden" name="eventId" value={r.id} /><button type="submit" className="link-quiet t-meta">This is part of my recruiting: add it</button></form>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
