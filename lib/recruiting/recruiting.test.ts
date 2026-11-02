import assert from "node:assert/strict";
import test from "node:test";
import { buildActions } from "./actions.ts";
import { extractAll, extractEvent } from "./extract.ts";
import { buildDemoMailbox } from "./fixtures.ts";
import { applyCorrection, buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent } from "./types.ts";

const NOW = new Date(Date.UTC(2026, 10, 1, 9, 0)); // Sun Nov 1 2026 09:00 floating
const mailbox = buildDemoMailbox(NOW);

function effective(): EffectiveEvent[] {
  return extractAll(mailbox.map((f) => f.email)).map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
}

test("extraction matches fixture ground truth for type, company and role", () => {
  for (const { email, expected } of mailbox.filter((f) => !f.email.outbound)) {
    const event = extractEvent(email);
    if (expected.type === null) {
      assert.equal(event, null, `noise extracted: ${email.subject}`);
      continue;
    }
    assert.ok(event, `missed: ${email.subject}`);
    assert.equal(event.type, expected.type, `type for: ${email.subject}`);
    if (expected.company) assert.equal(event.company, expected.company, `company for: ${email.subject}`);
    if (expected.role) assert.equal(event.role, expected.role, `role for: ${email.subject}`);
    if (expected.hasDate) assert.ok(event.eventDate, `date for: ${email.subject}`);
  }
});

test("extracted events never carry email body text", () => {
  for (const event of effective()) {
    const json = JSON.stringify(event);
    assert.ok(!json.includes("Hi Sam"), "body leaked into event");
  }
});

test("outbound mail is kept only inside recruiting threads", () => {
  const unrelated = {
    id: "x1", threadId: "unrelated", from: "Sam <sam@example.com>", subject: "Dinner?",
    receivedAt: NOW, outbound: true, bodyText: "pizza?",
  };
  const events = extractAll([...mailbox.map((f) => f.email), unrelated]);
  assert.ok(!events.some((e) => e.gmailMessageId === "x1"));
  assert.ok(events.some((e) => e.type === "user_reply" && e.company === "Datadog"));
});

test("events group into one opportunity per company/role with correct stages", () => {
  const opps = buildOpportunities(effective());
  const by = Object.fromEntries(opps.map((o) => [o.company, o]));
  assert.deepEqual(Object.keys(by).sort(), ["Airbnb", "Datadog", "Notion", "Ramp", "Roblox", "Stripe", "Vercel"]);
  assert.equal(by.Stripe.stage, "assessment");
  assert.equal(by.Stripe.events.length, 2, "HackerRank email joins the Stripe opportunity");
  assert.equal(by.Datadog.stage, "interview");
  assert.equal(by.Datadog.events.length, 4);
  assert.equal(by.Notion.stage, "interview");
  assert.equal(by.Roblox.status, "closed");
  assert.equal(by.Roblox.outcome, "rejected");
  assert.equal(by.Ramp.stage, "offer");
  assert.equal(by.Vercel.stage, "recruiter");
});

test("Today actions are prioritised and exclude closed opportunities", () => {
  const actions = buildActions(buildOpportunities(effective()), NOW);
  const kinds = actions.map((a) => `${a.company}:${a.kind}:${a.bucket}`);
  assert.ok(kinds.includes("Datadog:schedule_interview:overdue"), kinds.join(", "));
  assert.ok(kinds.includes("Stripe:assessment_deadline:soon"));
  assert.ok(kinds.includes("Notion:upcoming_interview:soon"));
  assert.ok(kinds.includes("Ramp:offer_decision:soon"));
  assert.ok(kinds.includes("Vercel:respond_recruiter:today"));
  assert.ok(kinds.includes("Airbnb:follow_up:worth_a_look"));
  assert.ok(!actions.some((a) => a.company === "Roblox"));
  // overdue first
  assert.equal(actions[0].bucket, "overdue");
  // sorted by bucket then priority
  const order = ["overdue", "today", "soon", "worth_a_look"];
  for (let i = 1; i < actions.length; i += 1) {
    assert.ok(order.indexOf(actions[i - 1].bucket) <= order.indexOf(actions[i].bucket));
  }
});

test("dismissed actions stay dismissed", () => {
  const opps = buildOpportunities(effective());
  const first = buildActions(opps, NOW)[0];
  const again = buildActions(opps, NOW, new Set([first.id]));
  assert.ok(!again.some((a) => a.id === first.id));
});

test("a user reply clears an unanswered recruiter-outreach action", () => {
  const events = effective().filter((e) => e.company !== "Vercel");
  const vercel = extractAll(mailbox.map((f) => f.email)).filter((e) => e.company === "Vercel")
    .map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
  const reply: EffectiveEvent = { ...vercel[0], id: "r", gmailMessageId: "r", type: "user_reply", outbound: true, occurredAt: NOW };
  const actions = buildActions(buildOpportunities([...events, ...vercel, reply]), NOW);
  assert.ok(!actions.some((a) => a.company === "Vercel" && a.kind === "respond_recruiter"));
});

test("corrections override extraction and can regroup or ignore events", () => {
  const raw = extractAll(mailbox.map((f) => f.email)).map((e) => ({ ...e, id: e.gmailMessageId }));
  const roblox = raw.find((e) => e.type === "rejection")!;
  const fixed = applyCorrection(roblox, { type: "follow_up" })!;
  assert.equal(fixed.type, "follow_up");
  assert.equal(fixed.corrected, true);
  assert.equal(applyCorrection(roblox, { ignored: true }), null);

  // Reassign the Vercel email to Datadog -> joins that opportunity.
  const vercel = raw.find((e) => e.company === "Vercel")!;
  const moved = applyCorrection(vercel, { company: "Datadog", role: "Backend Engineer Intern" })!;
  const rest = raw.filter((e) => e !== vercel).map((e) => ({ ...e, corrected: false }));
  const opps = buildOpportunities([...rest, moved]);
  assert.ok(!opps.some((o) => o.company === "Vercel"));
  assert.equal(opps.find((o) => o.company === "Datadog")!.events.length, 5);
});

test("user can close and reopen an opportunity", () => {
  const events = effective();
  const opps = buildOpportunities(events);
  const airbnb = opps.find((o) => o.company === "Airbnb")!;
  const closed = buildOpportunities(events, new Map([[airbnb.key, { status: "closed" as const }]]));
  assert.equal(closed.find((o) => o.company === "Airbnb")!.status, "closed");
  const roblox = opps.find((o) => o.company === "Roblox")!;
  const reopened = buildOpportunities(events, new Map([[roblox.key, { status: "active" as const }]]));
  assert.equal(reopened.find((o) => o.company === "Roblox")!.status, "active");
});
