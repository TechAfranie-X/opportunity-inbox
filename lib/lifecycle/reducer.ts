import { decide, DEFAULT_POLICY, type Policy } from "../recruiting/policy.ts";
import type { EffectiveEvent, EventType, Outcome, Stage } from "../recruiting/types.ts";

/**
 * The lifecycle reducer: STAGE (how far the process got) and STATUS (whether it is still open) are separate.
 *
 *  stage    the furthest stage reached on credible evidence. Monotonic: a later receipt or reminder never drags it back.
 *  status   "active" unless terminal evidence says otherwise, with the reason recorded (`closedBy`):
 *             rejected | withdrawn    an explicit ending by the employer or the person (a later stage event reopens it: a rejection that was reversed)
 *             expired                 an explicit expiry of the request the process was waiting on ("Request from X has expired"), with no progress since
 *             not_recruiting          nothing credible shows a candidacy (only results/receipts or doubtful wording): kept as history, out of the pipeline
 *  Evidence is credible when the person confirmed or corrected it, or its type passes the confidence policy. A doubtful reading can be shown and reviewed but
 *  never advances a stage, and an opportunity resting on nothing else is not in the pipeline until a person says it is.
 *  Dormancy (60 days of silence) is NOT a status: it only classifies follow-up suggestions (actions.ts). Silence never closes anything.
 */
export type ClosedBy = "rejected" | "withdrawn" | "expired" | "not_recruiting";
export type Lifecycle = { stage: Stage; outcome: Outcome; status: "active" | "closed"; closedBy: ClosedBy | null };

const STAGE_RANK: Record<Exclude<Stage, "closed">, number> = { applied: 0, recruiter: 1, assessment: 2, interview: 3, offer: 4 };
const STAGE_OF: Partial<Record<EventType, Stage>> = {
  applied: "applied", recruiter_outreach: "recruiter", assessment: "assessment", assessment_completed: "assessment", interview_invite: "interview", interview_scheduled: "interview", offer: "offer", rejection: "closed", withdrawn: "closed",
};
/**
 * A result or receipt for an assessment is something any assessment vendor can send to anyone (a personality profile, a practice test): by itself it does not show
 * a candidacy. Every other credible type (an application, an invitation, an interview, an offer, an employer's update or nudge, the person's own reply) does.
 */
const NOT_CANDIDACY = new Set<EventType>(["assessment_completed"]);

export const isCredible = (e: EffectiveEvent, policy: Policy = DEFAULT_POLICY): boolean =>
  e.corrected || e.confirmed === true || decide(e.type, e.fieldConfidence?.type ?? e.confidence, policy, "type").state === "accepted";

export function reduceLifecycle(events: EffectiveEvent[], policy: Policy = DEFAULT_POLICY): Lifecycle {
  // Doubtful readings never advance a stage while credible ones exist. When NOTHING credible exists the doubtful ones are all there is: they are used provisionally
  // (and the review queue asks about them), because hiding an opportunity on doubt alone would hide what the person was asked to check.
  const credibleStage = events.some((e) => isCredible(e, policy) && STAGE_OF[e.type]);
  const usable = (e: EffectiveEvent) => (credibleStage ? isCredible(e, policy) : true);
  let stage: Exclude<Stage, "closed"> = "applied";
  let outcome: Outcome = null;
  let ended: "rejected" | "withdrawn" | null = null;
  let expired = false;
  let candidacy = false;

  for (const e of events) {
    if (e.type === "status_update" && e.signals.includes("request expired") && isCredible(e, policy)) {
      // the request the process was waiting on lapsed (and the notice itself shows a request existed). A lapse after the process moved past assessment is old news.
      if (!ended && STAGE_RANK[stage] <= STAGE_RANK.assessment) { stage = "assessment"; expired = true; }
      continue;
    }
    if (!NOT_CANDIDACY.has(e.type) && STAGE_OF[e.type]) candidacy = true;
    if (!usable(e)) continue;
    const s = STAGE_OF[e.type];
    if (!s) continue;
    if (s === "closed") { ended = e.type === "rejection" ? "rejected" : "withdrawn"; outcome = ended; expired = false; continue; }
    if (ended) { ended = null; stage = s; outcome = e.type === "offer" ? "offer" : null; continue; } // reopened
    if (expired) expired = false; // progress after an expiry: a new request, a new step
    if (STAGE_RANK[s] >= STAGE_RANK[stage]) stage = s;
    if (e.type === "offer") outcome = "offer";
  }
  // An offer followed by the employer's onboarding mail (marked by the refinement layer) is an accepted offer: settled, no decision pending.
  if (!ended && outcome === "offer") {
    const firstOffer = events.find((e) => e.type === "offer" && !e.outbound && usable(e));
    if (firstOffer && events.some((e) => !e.outbound && e.occurredAt.getTime() > firstOffer.occurredAt.getTime() && (e.signals.includes("onboarding (refined)") || e.signals.includes("after offer (refined)")))) outcome = "accepted";
  }
  // An interview that rests ONLY on doubtful, undated wording ("interview" with no time, read at low confidence: typically a cancellation or a vague note) is not evidence
  // that an interview exists. It is kept as history and put to the person in review; it does not hold a place in the pipeline until they confirm it.
  if (!ended && !credibleStage && events.length > 0 && events.every((e) => (e.type === "interview_scheduled" || e.type === "interview_invite") && !e.eventDate && !isCredible(e, policy))) {
    return { stage, outcome: null, status: "closed", closedBy: "not_recruiting" };
  }
  if (ended) return { stage: "closed", outcome, status: "closed", closedBy: ended };
  if (expired) return { stage, outcome: "expired", status: "closed", closedBy: "expired" };
  // results and receipts for an assessment are not, by themselves, evidence of an application; an employer's update or nudge is (the review queue decides the rest)
  if (!candidacy && !events.some((e) => e.type !== "assessment_completed" && e.type !== "status_update" && e.type !== "follow_up" && e.type !== "user_reply") && events.every((e) => e.type === "assessment_completed")) return { stage, outcome: null, status: "closed", closedBy: "not_recruiting" };
  return { stage, outcome, status: "active", closedBy: null };
}
