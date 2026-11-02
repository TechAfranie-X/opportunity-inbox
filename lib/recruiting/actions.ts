import { DEFAULT_POLICY, type Policy } from "./policy.ts";
import type { ActionItem, ActionKind, EffectiveEvent, Opportunity } from "./types.ts";

const DAY = 86_400_000;

function dayStart(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Convert a real instant to a "floating" Date whose UTC fields equal the local wall clock. */
export function toFloating(now: Date) {
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()),
  );
}

const BASE: Record<ActionKind, number> = {
  offer_decision: 90,
  upcoming_interview: 85,
  assessment_deadline: 80,
  schedule_interview: 75,
  respond_recruiter: 60,
  follow_up: 40,
  check_in: 30,
};

const BUCKET_ORDER = { overdue: 0, today: 1, soon: 2, worth_a_look: 3 } as const;

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function when(daysUntil: number) {
  if (daysUntil < 0) return `${plural(-daysUntil, "day")} ago`;
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  return `in ${plural(daysUntil, "day")}`;
}

/** A passed deadline is only actionable (extension request) for this many days. */
const STALE_AFTER_DEADLINE_DAYS = 3;
/** Offers with a passed deadline stop appearing after this grace period. */
const OFFER_GRACE_DAYS = 7;
/** Unanswered invites/outreach count as overdue only this long; after that they are probably gone. */
const INVITE_OVERDUE_MAX_DAYS = 14;

const PROGRESS_AFTER_ASSESSMENT = new Set(["assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"]);

/**
 * Derive "what needs my attention" from opportunity state.
 * `now` must be a floating date (see `toFloating`). Pure and deterministic.
 */
export function buildActions(
  opportunities: Opportunity[],
  now: Date,
  dismissed: Set<string> = new Set(),
  policy: Policy = DEFAULT_POLICY,
): ActionItem[] {
  const today = dayStart(now);
  const items: ActionItem[] = [];

  const add = (
    opp: Opportunity,
    source: EffectiveEvent,
    kind: ActionKind,
    title: string,
    reason: string,
    opts: { due?: Date | null; dueHasTime?: boolean; daysUntil?: number; bucket?: ActionItem["bucket"] },
  ) => {
    const id = `${kind}:${opp.key}:${source.gmailMessageId}`;
    if (dismissed.has(id)) return;
    const d = opts.daysUntil;
    let bucket = opts.bucket;
    if (!bucket) {
      bucket = d === undefined ? "worth_a_look" : d < 0 ? "overdue" : d === 0 ? "today" : d <= 7 ? "soon" : "worth_a_look";
    }
    // Abstention: an action resting on an event we are unsure about must not shout. It stays visible, quietly, and says so.
    let uncertain = false;
    const trust = source.corrected ? 1 : Math.min(source.fieldConfidence?.type ?? source.confidence, source.company ? (source.fieldConfidence?.company ?? 1) : 1);
    if ((bucket === "overdue" || bucket === "today") && trust < policy.urgentMinConfidence) {
      bucket = "worth_a_look";
      uncertain = true;
    }
    let priority = BASE[kind];
    if (d !== undefined) priority += d < 0 ? 20 : d === 0 ? 15 : d <= 1 ? 10 : d <= 3 ? 5 : 0;
    items.push({
      id, kind, opportunityKey: opp.key, company: opp.company, role: opp.role, title, reason,
      due: opts.due ?? null, dueHasTime: opts.dueHasTime ?? false, bucket, priority, ...(uncertain ? { uncertain } : {}),
      sourceThreadId: source.gmailThreadId,
    });
  };

  for (const opp of opportunities) {
    if (opp.status !== "active") continue;
    const events = opp.events;
    const idx = (e: EffectiveEvent) => events.indexOf(e);
    const last = events[events.length - 1];
    const laterThan = (e: EffectiveEvent) => events.slice(idx(e) + 1);
    const lastOf = (...types: string[]) => [...events].reverse().find((e) => types.includes(e.type));
    const ageDays = (e: EffectiveEvent) => Math.floor((today - dayStart(e.occurredAt)) / DAY);

    // 1. Assessment deadline
    const assessment = lastOf("assessment");
    if (assessment && !laterThan(assessment).some((e) => PROGRESS_AFTER_ASSESSMENT.has(e.type))) {
      if (assessment.eventDate) {
        const d = Math.round((dayStart(assessment.eventDate) - today) / DAY);
        // Within 14 days ahead, or at most 3 days past due. Older than that it is history, not an action.
        if (d <= 14 && d >= -STALE_AFTER_DEADLINE_DAYS) {
          add(opp, assessment, "assessment_deadline",
            d < 0 ? "Assessment deadline passed" : "Complete your assessment",
            d < 0 ? `Due ${when(d)} — if you haven't finished, ask the recruiter about an extension.` : `Due ${when(d)}.`,
            { due: assessment.eventDate, dueHasTime: assessment.eventDateHasTime, daysUntil: d });
        }
      } else if (ageDays(assessment) <= 14) {
        add(opp, assessment, "assessment_deadline", "Assessment waiting",
          `Assigned ${when(-ageDays(assessment))}; no deadline detected — check the email.`, { bucket: "soon" });
      }
    }

    // 2. Upcoming / just-finished interview
    const interview = lastOf("interview_scheduled");
    if (interview?.eventDate) {
      const d = Math.round((dayStart(interview.eventDate) - today) / DAY);
      const after = laterThan(interview);
      if (d >= 0 && d <= 7) {
        add(opp, interview, "upcoming_interview", "Interview coming up", `Scheduled ${when(d)}.`,
          { due: interview.eventDate, dueHasTime: interview.eventDateHasTime, daysUntil: d });
      } else if (d < 0 && d >= -2 && !after.some((e) => e.outbound || e.type === "rejection" || e.type === "offer")) {
        add(opp, interview, "follow_up", "Send a thank-you note", `Your interview was ${when(d)}.`, { bucket: "today" });
      } else if (d <= -7 && d >= -30 && !after.some((e) => e.type === "rejection" || e.type === "offer" || e.type === "interview_scheduled" || e.type === "interview_invite")) {
        add(opp, interview, "follow_up", "No word since your interview",
          `Interview was ${-d} days ago with no update — consider following up.`, { bucket: "worth_a_look" });
      }
    }

    // 3. Interview invite waiting on you
    const invite = lastOf("interview_invite");
    if (invite && !invite.outbound) {
      const answered = laterThan(invite).some((e) => e.outbound || e.type === "interview_scheduled" || e.type === "rejection" || e.type === "offer");
      const age = ageDays(invite);
      if (!answered && age <= 30) {
        const stale = age > INVITE_OVERDUE_MAX_DAYS;
        add(opp, invite, "schedule_interview", stale ? "Old interview invite, still open?" : "Reply to schedule your interview",
          stale
            ? `They asked ${when(-age)} — it may have lapsed; a quick reply can revive it.`
            : `They asked ${when(-age)} — recruiters often hold slots only briefly.`,
          { daysUntil: age >= 2 ? -1 : 0, bucket: stale ? "worth_a_look" : age >= 2 ? "overdue" : "today" });
      }
    }

    // 4. Recruiter outreach not answered
    const outreach = lastOf("recruiter_outreach");
    if (outreach && !outreach.outbound) {
      const answered = laterThan(outreach).some((e) => e.outbound || (stageRank(e) > 1));
      const age = ageDays(outreach);
      if (!answered && age <= 21) {
        add(opp, outreach, "respond_recruiter", "Respond to recruiter",
          `Reached out ${when(-age)}${age >= 3 ? " — a reply is overdue" : ""}.`,
          { bucket: age >= 3 ? "overdue" : age >= 1 ? "today" : "today", daysUntil: age >= 3 ? -1 : 0 });
      }
    }

    // 5. Offer decision. Later activity (a reply, "congrats on accepting") means it is being handled.
    const offer = lastOf("offer");
    if (offer && !laterThan(offer).some((e) => e.type === "withdrawn" || e.type === "rejection")) {
      const after = laterThan(offer);
      if (offer.eventDate) {
        const d = Math.round((dayStart(offer.eventDate) - today) / DAY);
        if (d >= -OFFER_GRACE_DAYS) {
          add(opp, offer, "offer_decision", "Offer decision due",
            d < 0 ? `Deadline was ${when(d)}.` : `Respond ${when(d)}.`,
            { due: offer.eventDate, dueHasTime: offer.eventDateHasTime, daysUntil: d });
        }
      } else if (after.length === 0 && ageDays(offer) <= 30) {
        add(opp, offer, "offer_decision", "You have an offer", "No deadline detected — confirm the response date.",
          { bucket: "today", daysUntil: 0 });
      }
    }

    // 6. Waiting on them: gentle follow-up nudges
    const quiet = Math.floor((today - dayStart(last.occurredAt)) / DAY);
    const alreadyActed = items.some((i) => i.opportunityKey === opp.key);
    if (!alreadyActed) {
      if (opp.stage === "applied" && !last.outbound && quiet >= 14 && quiet <= 45) {
        add(opp, last, "follow_up", "No response yet", `Applied ${quiet} days ago with no update — consider a follow-up.`, { bucket: "worth_a_look" });
        // Rank quiet applications: around three weeks of silence is the most useful moment to nudge.
        items[items.length - 1].priority -= Math.abs(quiet - 21) * 0.5;
      } else if (last.outbound && quiet >= 7 && quiet <= 45) {
        add(opp, last, "check_in", "Still waiting to hear back", `You last wrote ${quiet} days ago with no reply.`, { bucket: "worth_a_look" });
      } else if (opp.stage === "assessment" && last.type === "assessment_completed" && quiet >= 7 && quiet <= 45) {
        add(opp, last, "check_in", "Assessment submitted, no update", `Submitted ${quiet} days ago — consider checking in.`, { bucket: "worth_a_look" });
      }
    }
  }

  return items.sort(
    (a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || b.priority - a.priority,
  );
}

/** Rough "has the process advanced beyond first contact" test. */
function stageRank(e: EffectiveEvent) {
  switch (e.type) {
    case "assessment": case "assessment_completed": case "interview_invite":
    case "interview_scheduled": case "offer": case "rejection":
      return 2;
    default:
      return 0;
  }
}
