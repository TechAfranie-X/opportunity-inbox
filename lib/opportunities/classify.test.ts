import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classificationDisplayLabel,
  classifyOpportunityEmail,
  EMPTY_PROVIDER_SIGNALS,
} from "./classify.ts";

test("display labels are human-readable and hide score details", () => {
  assert.equal(classificationDisplayLabel("opportunity"), "Opportunity");
  assert.equal(classificationDisplayLabel("not_opportunity"), "Not opportunity");
  assert.equal(classificationDisplayLabel("unknown"), "Needs review");
});

test("canonical: application received is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your application has been received",
    from: "noreply@employer.com",
  });

  assert.equal(result.label, "opportunity");
  assert.equal(result.intent, "career_pipeline");
  assert.ok(result.matchedSignals.includes("application received"));
});

test("canonical: coding assessment is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Complete your coding assessment",
    from: "noreply@greenhouse.io",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("coding assessment"));
});

test("canonical: interview availability is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Interview availability for Software Engineering Internship",
    from: "campus@university.edu",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("interview scheduling"));
});

test("canonical: candidacy status update is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your candidacy status has been updated",
    from: "updates@employer.com",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("candidacy update"));
});

test("canonical: offer extended is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "We are pleased to extend you an offer",
    from: "talent@employer.com",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("offer letter"));
});

test("canonical: rejection is still pipeline mail", () => {
  const result = classifyOpportunityEmail({
    subject: "Thank you for applying. We will not be moving forward.",
    from: "recruiting@employer.com",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("application received"));
  assert.ok(result.matchedSignals.includes("moving forward"));
});

test("canonical: background check is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Background check required",
    from: "hr@employer.com",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("background check"));
});

test("direct: fellowship applications open is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Applications open for 2027 Engineering Fellowship",
    from: "programs@foundation.org",
  });

  assert.equal(result.label, "opportunity");
  assert.equal(result.intent, "direct_opportunity");
  assert.ok(result.matchedSignals.some((signal) => signal.includes("fellowship")));
});

test("direct: career conference registration is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Register for the Student Tech Career Conference by Friday",
    from: "events@nsbe.org",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.some((signal) => signal.includes("register")));
});

test("direct: invited to apply is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "You've been invited to apply for our research program",
    from: "lab@university.edu",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("invited to apply"));
});

test("direct: apply now for a hackathon is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Apply now for our hackathon",
    from: "hello@studentclub.org",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("hackathon"));
});

test("discovery: jobs for you is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "10 new software engineering jobs for you",
    from: "alerts@jobboard.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("jobs for you"));
});

test("discovery: weekly job matches is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your weekly job matches",
    from: "alerts@jobboard.com",
  });

  assert.equal(result.label, "not_opportunity");
});

test("discovery: dream job waiting is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your dream job is waiting",
    from: "alerts@jobboard.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("dream job"));
});

test("discovery: ATS sender cannot turn job recommendations into opportunities", () => {
  const result = classifyOpportunityEmail({
    subject: "Weekly jobs you may like",
    from: "careers@greenhouse.io",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("jobs you may like"));
});

test("content: hackathon documentary is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Inside a Hong Kong hackathon - documentary",
    from: "editor@media.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("documentary"));
});

test("content: interview how-to is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "How to ace your software engineering interview",
    from: "tips@careerblog.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("how to"));
});

test("content: interview tips blog is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Interview tips from our career blog",
    from: "tips@example.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("tips"));
});

test("content: short course is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Welcome to our Machine Learning Short Course",
    from: "team@school.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("short course"));
});

test("content: watch hackathon documentary is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Watch our hackathon documentary",
    from: "films@media.com",
  });

  assert.equal(result.label, "not_opportunity");
});

test("commerce: price drop is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "PRICE DROP - 80% OFF",
    from: "deals@shop.example",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("price drop"));
  assert.ok(result.matchedSignals.includes("% off"));
});

test("commerce: shipped order is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your order has shipped",
    from: "orders@store.example",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("order"));
});

test("commerce: special offer does not count as a job offer", () => {
  const result = classifyOpportunityEmail({
    subject: "Special Offer: 50% off",
    from: "promo@shop.example",
  });

  assert.equal(result.label, "not_opportunity");
  assert.equal(result.matchedSignals.includes("offer letter"), false);
});

test("finance: credit report is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your credit report is ready",
    from: "alerts@credit.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("credit report"));
});

test("finance: loan matches are not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "You have new loan matches",
    from: "offers@lender.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("loan"));
});

test("security: 2-step verification is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "2-Step Verification turned on",
    from: "no-reply@google.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("2-step verification"));
});

test("security: storage warning is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your Gmail storage is 80% full",
    from: "noreply@google.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("storage warning"));
});

test("social: post impressions are not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your posts got 10 impressions",
    from: "notify@linkedin.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("impressions"));
});

test("social: new invitations are not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "You have 5 new invitations",
    from: "notify@linkedin.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("new invitations"));
});

test("meeting: joined meeting is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Alice has joined your meeting",
    from: "noreply@zoom.us",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("meeting notification"));
});

test("meeting: cloud recording is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your cloud recording is ready",
    from: "noreply@zoom.us",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("meeting recording"));
});

test("conflict: promotional internship assessment is not rejected", () => {
  const result = classifyOpportunityEmail({
    subject:
      "Microsoft Software Engineering Internship - Complete Your Coding Assessment",
    from: "Microsoft Careers <careers@microsoft.com>",
    listUnsubscribe: "<https://example.com/unsub>",
    providerSignals: { ...EMPTY_PROVIDER_SIGNALS, promotional: true },
  });

  assert.notEqual(result.label, "not_opportunity");
  assert.equal(result.label, "opportunity");
  assert.ok(result.pipelineScore >= 3);
  assert.ok(result.matchedSignals.includes("coding assessment"));
  assert.ok(result.matchedSignals.includes("provider:promotional"));
});

test("conflict: interview invitation plus newsletter stays needs review", () => {
  const result = classifyOpportunityEmail({
    subject: "Interview invitation and weekly newsletter",
    from: "recruiter@acme.com",
  });

  assert.equal(result.label, "unknown");
  assert.ok(result.pipelineScore >= 3);
  assert.ok(result.noiseScore >= 3);
});

test("sender: generic sender with application status is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your application status changed",
    from: "hello@company.com",
  });

  assert.equal(result.label, "opportunity");
});

test("sender: no-reply remains neutral for interview confirmation", () => {
  const result = classifyOpportunityEmail({
    subject: "Interview confirmation",
    from: "noreply@employer.com",
  });

  assert.equal(result.label, "opportunity");
  assert.equal(
    result.matchedSignals.some((signal) => signal.includes("noreply")),
    false,
  );
});

test("unknown: next steps without context needs review", () => {
  const result = classifyOpportunityEmail({
    subject: "Next steps",
    from: "alex@company.com",
  });

  assert.equal(result.label, "unknown");
});

test("unknown: following up needs review", () => {
  const result = classifyOpportunityEmail({
    subject: "Following up",
    from: "alex@company.com",
  });

  assert.equal(result.label, "unknown");
});

test("unknown: congratulations needs review", () => {
  const result = classifyOpportunityEmail({
    subject: "Congratulations!",
    from: "alex@company.com",
  });

  assert.equal(result.label, "unknown");
});

test("unknown: update needs review", () => {
  const result = classifyOpportunityEmail({
    subject: "Update",
    from: "alex@company.com",
  });

  assert.equal(result.label, "unknown");
});

test("regression: interview invitation is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "  Interview Invitation from Acme  ",
    from: "Jane Recruiter <jane.recruiter@acme.com>",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.score >= 3);
  assert.ok(result.matchedSignals.includes("interview"));
  assert.ok(result.matchedSignals.includes("sender:career-role"));
});

test("regression: discount sale is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Flash sale: 50% off your order",
    from: "deals@shop.example",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.score <= -3);
  assert.ok(result.matchedSignals.includes("% off"));
  assert.ok(result.matchedSignals.includes("sale"));
  assert.ok(result.matchedSignals.includes("order"));
});

test("regression: receipt and shipping is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your receipt and shipping update",
    from: "billing@store.example",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("receipt"));
  assert.ok(result.matchedSignals.includes("shipping"));
});

test("regression: generic greeting stays unknown", () => {
  const result = classifyOpportunityEmail({
    subject: "Hello from the team",
    from: "alex@gmail.com",
  });

  assert.equal(result.label, "unknown");
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedSignals, []);
});

test("regression: recruiter domain alone stays unknown", () => {
  const result = classifyOpportunityEmail({
    subject: "Quick hello",
    from: "talent@greenhouse.io",
  });

  assert.equal(result.label, "unknown");
  assert.ok(result.score < 3);
  assert.ok(result.score > -3);
  assert.ok(result.matchedSignals.includes("knowledge:job-platform"));
});

test("regression: sender cannot dominate a strong negative subject", () => {
  const result = classifyOpportunityEmail({
    subject: "VIP sale: 40% off",
    from: "careers@greenhouse.io",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("sale"));
  assert.ok(result.matchedSignals.includes("knowledge:job-platform"));
});

test("regression: sales internship is an opportunity, not a commerce sale", () => {
  const result = classifyOpportunityEmail({
    subject: "Sales internship next steps",
    from: "campus@university.edu",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("internship"));
  assert.equal(result.matchedSignals.includes("sale"), false);
});

test("regression: in order to does not trigger the order signal", () => {
  const result = classifyOpportunityEmail({
    subject: "Please reply in order to schedule your interview",
    from: "recruiter@acme.com",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("interview"));
  assert.equal(result.matchedSignals.includes("order"), false);
});

test("regression: Jomashop marketing is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Omega or Rolex?",
    from: "Jomashop <news@jomashop.com>",
    listUnsubscribe: "<mailto:unsub@jomashop.com>",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("knowledge:commerce"));
});

test("regression: AWS marketing email is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "New ways to build on AWS",
    from: "Amazon Web Services <aws-marketing@amazon.com>",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("knowledge:aws-marketing"));
});

test("regression: DeepLearning.AI course marketing is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Enroll in our new short course",
    from: "DeepLearning.AI <team@deeplearning.ai>",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("short course"));
  assert.ok(result.matchedSignals.includes("knowledge:education-marketing"));
});

test("regression: Experian loan email is not an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Amount owed on your loan",
    from: "Experian <noreply@experian.com>",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("amount owed"));
  assert.ok(result.matchedSignals.includes("loan"));
  assert.ok(result.matchedSignals.includes("knowledge:credit"));
});

test("regression: Simplify job matches are discovery", () => {
  const result = classifyOpportunityEmail({
    subject: "12 new job matches for you",
    from: "Simplify <hello@simplify.jobs>",
    listUnsubscribe: "<mailto:unsub@simplify.jobs>",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.noiseScore >= 3);
  assert.ok(result.careerScore < 3);
  assert.ok(result.matchedSignals.includes("new job matches"));
  assert.ok(result.matchedSignals.includes("knowledge:job-platform"));
});

test("regression: Fidelity candidacy update is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your candidacy status has been updated",
    from: "Fidelity Investments <noreply@fidelity.com>",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("candidacy update"));
});

test("regression: Ramp coding assessment reminder is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Reminder: complete your Ramp coding assessment",
    from: "Ramp <noreply@ramp.com>",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("coding assessment"));
});

test("regression: CodeSignal assessment expiration is an opportunity", () => {
  const result = classifyOpportunityEmail({
    subject: "Your coding assessment request has expired",
    from: "CodeSignal <noreply@codesignal.com>",
  });

  assert.equal(result.label, "opportunity");
  assert.ok(result.matchedSignals.includes("coding assessment"));
});

test("regression: recommended jobs are discovery noise", () => {
  const result = classifyOpportunityEmail({
    subject: "Recommended jobs you may like this week",
    from: "alerts@handshake.com",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("recommended jobs"));
});

test("regression: event feedback surveys are not opportunities", () => {
  const result = classifyOpportunityEmail({
    subject: "Share your experience and give feedback",
    from: "events@university.edu",
  });

  assert.equal(result.label, "not_opportunity");
  assert.ok(result.matchedSignals.includes("survey"));
});
