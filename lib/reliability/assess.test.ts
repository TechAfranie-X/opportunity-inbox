import assert from "node:assert/strict";
import test from "node:test";
import { buildActions } from "../recruiting/actions.ts";
import { extractAll } from "../recruiting/extract.ts";
import { buildOpportunities, eventNeedsReview } from "../recruiting/opportunity.ts";
import { reconcilePredictions } from "../discovery/continuity.ts";
import { buildPredictions } from "../recruiting/predictions.ts";
import { attentionCount, buildReviewQueue } from "../recruiting/review.ts";
import type { EffectiveEvent, ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { membershipDoubt, nearMiss, outcomeConflict, readMail } from "./assess.ts";
import { hasDoubt, isNearMiss, isWeakNearMiss } from "./flags.ts";
import { companyGrounded, groundingOf, roleGrounded } from "./grounding.ts";
import { HOLDOUT, STRESS, type Stress } from "./stress-set.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const IMP = ["INBOX", "IMPORTANT"];
const mail = (over: Partial<RecruitingEmail> & { subject: string; bodyText: string }): RecruitingEmail => ({ id: "m1", threadId: "t1", from: "Dana Reyes <dana.reyes@brightpath.example>", receivedAt: NOW, outbound: false, labels: IMP, ...over });
const asEffective = (e: ExtractedEvent): EffectiveEvent => ({ ...e, id: e.gmailMessageId, corrected: false });

// ------------------------------------------------------------------ grounding
test("grounding: a company or role the message does not contain is dropped to unknown and sent to review", () => {
  const email = mail({ subject: "Thank you for applying", bodyText: "Hi Sam, thank you for applying to the Backend Engineer Intern position at Acme. We received your application." });
  assert.equal(companyGrounded(email, "Acme"), true);
  assert.equal(companyGrounded(email, "Initech"), false);
  assert.equal(roleGrounded(email, "Backend Engineer Intern"), true);
  assert.equal(roleGrounded(email, "Quantitative Researcher"), false);
  assert.equal(companyGrounded({ ...email, from: "Careers <jobs@capitalone.com>", subject: "Hi", bodyText: "Hi" }, "Capital One"), true, "a name run together in a domain is traceable to it");

  const fake = { ...extractAll([email])[0], company: "Initech", role: "Quantitative Researcher", signals: ["application confirmation"] };
  const g = groundingOf(email, fake);
  assert.deepEqual(g, { company: false, role: false });
  assert.deepEqual(groundingOf(email, { ...fake, signals: ["known-contact-continuity"] }), { company: true, role: true }, "linked events are traced to the message they were linked to");
  assert.equal(groundingOf(email, { ...fake, company: "Acme", signals: ["role-inherited"] }).role, true, "an inherited role is traced to its source");
});

test("readMail never shows a value it cannot trace: every company and role it returns is grounded", () => {
  for (const s of [...STRESS, ...HOLDOUT]) {
    for (const e of readMail([s.email])) {
      if (isNearMiss(e)) continue;
      const g = groundingOf(s.email, e);
      assert.ok(g.company && g.role, `${s.name}: untraceable value shown`);
    }
  }
});

// ------------------------------------------------------------------ weak membership
test("membership doubt: no named application and Gmail did not call it important; absent labels are NOT evidence against", () => {
  const body = "Thanks for reaching out. We will get back to you about the Backend Engineer Intern opening.";
  const e = extractAll([mail({ subject: "Re: hello", bodyText: body, labels: ["INBOX"] })])[0];
  const noLabels = mail({ subject: "Re: hello", bodyText: body, labels: undefined });
  assert.equal(membershipDoubt(noLabels, e ?? ({ signals: [] } as never)), null);
  assert.equal(membershipDoubt(mail({ subject: "Re: hello", bodyText: body, labels: [] }), e ?? ({ signals: [] } as never)), null);
  assert.match(membershipDoubt(mail({ subject: "Re: hello", bodyText: body, labels: ["INBOX"] }), { signals: [] } as never) ?? "", /^membership:/);
  assert.equal(membershipDoubt(mail({ subject: "Re: hello", bodyText: body, labels: IMP }), { signals: [] } as never), null, "important");
  assert.equal(membershipDoubt(mail({ subject: "x", bodyText: "Following up on your application for the Backend Engineer Intern role", labels: ["INBOX"] }), { signals: [] } as never), null, "names an application");
  assert.equal(membershipDoubt(mail({ subject: "x", bodyText: "hello", labels: ["INBOX"] }), { signals: ["reply-in-recruiting-thread"] } as never), null, "linked to a known candidacy");
});

test("a course or promotion that borrows hiring words is doubted even with no Gmail labels at all", () => {
  const email = mail({ subject: "Next steps for your application to the data course", bodyText: "Complete your enrollment today and get 20% off tuition.", labels: undefined });
  const [e] = readMail([email]);
  assert.ok(e && hasDoubt(e), "shown only with doubt");
});

test("doubt is visible and quiet: it is in review, and its deadline is never an urgent action", () => {
  const email = mail({ id: "d1", threadId: "td1", from: "Dana <dana.reyes@brightpath.example>", subject: "Online assessment", bodyText: "Hi Sam, please complete the online assessment for the Backend Engineer Intern role by tomorrow at 11:59 PM.", labels: ["INBOX"] });
  const [event] = readMail([{ ...email, receivedAt: new Date(NOW.getTime() - 3_600_000) }]);
  assert.ok(event && hasDoubt(event) === true);
  const effective = [{ ...asEffective(event!), eventDate: new Date("2026-11-10T23:59:00Z"), dateKind: "deadline" as const }];
  const opportunities = buildOpportunities(effective);
  assert.equal(eventNeedsReview(effective[0]), true);
  const urgent = buildActions(opportunities, NOW).filter((a) => a.bucket === "today" || a.bucket === "overdue");
  assert.equal(urgent.length, 0, "no alarm on a doubtful event");
  const settled = [{ ...effective[0], confirmed: true }];
  assert.equal(eventNeedsReview(settled[0]), false, "a person's word settles it");
  assert.ok(buildActions(buildOpportunities(settled), NOW).some((a) => a.bucket === "today"), "and the alarm returns once they confirm");
});

// ------------------------------------------------------------------ conflict
test("a goodbye typed as an ongoing update is a conflict; a pleasantry about something upcoming is not", () => {
  const goodbye = mail({ subject: "Following up on your application", bodyText: "Thanks for your time on Thursday. We are going to keep looking for someone with more experience. Best of luck with your search." });
  const [e] = readMail([goodbye]);
  assert.equal(e.type, "follow_up");
  assert.ok(hasDoubt(e), "flagged instead of shown as a plain follow-up");
  const upbeat = mail({ subject: "Online assessment", bodyText: "Please complete the online assessment for the Backend Engineer Intern role by Friday. Good luck on the assessment!" });
  assert.equal(outcomeConflict(upbeat, extractAll([upbeat])[0]), null);
});

// ------------------------------------------------------------------ near misses
test("near miss: rejected by the reader, but important, naming a candidacy, not bulk -> strong; counted. Weak ones are folded and uncounted.", () => {
  const strong = mail({ subject: "Quick note", bodyText: "Hi Sam, about your candidacy for the Backend Engineer Intern role: the team has gone another direction for this cycle." });
  assert.equal(extractAll([strong]).length, 0, "the reader does not recognise it");
  const near = nearMiss(strong);
  assert.ok(near && isNearMiss(near) && !isWeakNearMiss(near));
  assert.equal(nearMiss({ ...strong, labels: ["INBOX"] }), null, "not important");
  assert.equal(nearMiss({ ...strong, bodyText: strong.bodyText + " Unsubscribe or manage preferences." }), null, "bulk mail is not a near miss");
  assert.equal(nearMiss({ ...strong, outbound: true }), null);

  const weak = nearMiss(mail({ from: "Casey <casey.park@quill-labs.example>", subject: "grab a time", bodyText: "Grab any slot here for a chat about the Analytics Intern role." }));
  assert.ok(weak && isWeakNearMiss(weak));
  const unreadable = nearMiss(mail({ subject: "Your candidate profile", bodyText: "", bodyUnreadable: true }));
  assert.ok(unreadable && !isWeakNearMiss(unreadable) && /could not read/.test(unreadable.reviewReasons![0]));
  assert.equal(nearMiss(mail({ subject: "dinner?", bodyText: "are we still on for dinner", from: "Alex <alex@mail.example>" })), null);
});

test("a near miss is not a recruiting decision: the log keeps the rejection and records that it was surfaced", () => {
  const email = mail({ subject: "Quick note", bodyText: "Hi Sam, about your candidacy for the Backend Engineer Intern role: the team has gone another direction for this cycle." });
  const events = readMail([email]);
  assert.equal(events.length, 1);
  const predictions = reconcilePredictions(buildPredictions([email]), events);
  assert.equal(predictions[0].decision, "not_recruiting");
  assert.ok(predictions[0].signals.includes("near-miss"));
});

test("review: near misses join the queue after the real items, the badge counts only the strong ones, and none of them is in the pipeline", () => {
  const real = extractAll([mail({ id: "r1", threadId: "tr", subject: "Thank you for applying to Acme", bodyText: "Thank you for applying to the Backend Engineer Intern position at Acme. We received your application.", from: "Acme <jobs@us.greenhouse-mail.io>" })]);
  const strong = readMail([mail({ id: "n1", threadId: "tn1", subject: "Quick note", bodyText: "About your candidacy for the Backend Engineer Intern role: the team has gone another direction for this cycle." })]);
  const weak = readMail([mail({ id: "n2", threadId: "tn2", from: "Casey <casey.park@quill-labs.example>", subject: "grab a time", bodyText: "Grab any slot here for a chat about the Analytics Intern role." })]);
  const opportunities = buildOpportunities(real.map(asEffective));
  const queue = buildReviewQueue(opportunities, undefined, [...strong, ...weak].map(asEffective));
  assert.equal(opportunities.every((o) => o.events.every((e) => !isNearMiss(e))), true, "near misses are not in the pipeline");
  assert.deepEqual(queue.filter((i) => i.possible).map((i) => Boolean(i.weak)).sort(), [false, true]);
  assert.equal(attentionCount(queue), queue.length - 1, "the weak one is offered, not counted");
  assert.ok(queue.filter((i) => i.possible).every((i) => i.opportunityKey === "" && i.reasons.length > 0));
});

// ------------------------------------------------------------------ stage never moves backward
test("a later 'thank you for applying' or recruiter nudge does not drag an interview back to applied; an ending ends it; a reversal reopens it", () => {
  const ev = (id: string, day: number, type: ExtractedEvent["type"]): EffectiveEvent => ({ id, gmailMessageId: id, gmailThreadId: "t", occurredAt: new Date(NOW.getTime() + day * 86_400_000), outbound: false, senderName: "x", senderDomain: "acme.com", subject: "s", type, company: "Acme", role: "Backend Engineer Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false });
  const stageOf = (types: ExtractedEvent["type"][]) => buildOpportunities(types.map((t, i) => ev(`e${i}`, i, t)))[0];
  assert.equal(stageOf(["applied", "assessment", "interview_scheduled", "applied"]).stage, "interview", "a duplicate receipt");
  assert.equal(stageOf(["applied", "interview_invite", "recruiter_outreach"]).stage, "interview", "a nudge");
  assert.equal(stageOf(["applied", "interview_scheduled", "offer", "applied"]).stage, "offer");
  assert.equal(stageOf(["applied", "interview_scheduled", "rejection"]).stage, "closed");
  assert.equal(stageOf(["applied", "interview_scheduled", "rejection"]).outcome, "rejected");
  assert.equal(stageOf(["applied", "rejection", "interview_invite"]).stage, "interview", "a rejection that was reversed");
  assert.equal(stageOf(["applied", "offer"]).outcome, "offer");
});

// ------------------------------------------------------------------ stress sets
type Outcome = "event" | "event+review" | "near-miss" | "near-miss(weak)" | "silent";
function outcomeOf(s: Stress): Outcome {
  const [e] = readMail([s.email]);
  if (!e) return "silent";
  if (isNearMiss(e)) return isWeakNearMiss(e) ? "near-miss(weak)" : "near-miss";
  return eventNeedsReview(asEffective(e)) || !e.company ? "event+review" : "event";
}

test("STRESS (a development set): no recruiting message is silent and nothing non-recruiting is shown as fact", () => {
  for (const s of STRESS) {
    const o = outcomeOf(s);
    if (s.truth === "recruiting") assert.notEqual(o, "silent", s.name);
    else assert.notEqual(o, "event", s.name);
  }
});

// The holdout was run once, untouched by tuning. These are its outcomes, pinned so any change must be deliberate. The three "silent" entries are
// KNOWN GAPS, listed here on purpose rather than hidden: recruiting mail with no hiring vocabulary and no named application.
const HOLDOUT_OUTCOMES: Record<string, Outcome> = {
  "scheduling link, informal": "near-miss", "verbal offer": "near-miss(weak)", "rejection, formal-lite": "event+review", "skills test from platform": "silent",
  "recruiter nudge": "near-miss(weak)", "interview preparation": "event+review", "reference request": "silent", "compensation call": "event",
  "intern housing": "near-miss(weak)", "application received, unusual": "near-miss(weak)", "virtual onsite agenda": "silent", "portal notification, no content": "near-miss(weak)",
};

test("HOLDOUT (written after the layer was frozen, never tuned against): recruiting outcomes are pinned, known gaps included, and no non-recruiting message is shown as fact", () => {
  for (const s of HOLDOUT) {
    const o = outcomeOf(s);
    if (s.truth === "recruiting") assert.equal(o, HOLDOUT_OUTCOMES[s.name], s.name);
    else assert.notEqual(o, "event", `${s.name} was shown as fact`);
  }
  const silent = HOLDOUT.filter((s) => s.truth === "recruiting" && outcomeOf(s) === "silent").length;
  assert.equal(silent, 3, "3 of 12 recruiting messages are still silent: reported, not hidden");
});
