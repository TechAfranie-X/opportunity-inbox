import { buildDemoMailbox, type FixtureEmail, type FixtureExpectation } from "./fixtures.ts";
import type { RecruitingEmail } from "./types.ts";

/**
 * The sample mailbox: about 150 synthetic emails across about 40 opportunities, deterministic for a given anchor date, written
 * with the same templates the extractor is built and tested against. It contains no real people or messages (company names are
 * used the way the demo uses them, as plausible employers). Every date is relative to `anchor`, so it always looks current:
 * interviews today and tomorrow, an assessment overdue, an offer with a deadline, a rejection followed by a re-application, an
 * unanswered recruiter, ghosted applications, vendor mail that never names the company (which must go to review), and noise.
 *
 * Purpose: realistic local data for developing and testing every signed-in journey, and a regression set for the extractor.
 * It is synthetic and written alongside the rules, so a high score on it is a regression guard, not an accuracy claim.
 */
export type SampleEmail = FixtureEmail & { /** The extractor is not expected to be certain about this one. */ uncertain?: boolean };

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

/** A tiny deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPANIES: Array<[string, string]> = [
  ["Figma", "Software Engineer Intern"], ["Plaid", "Backend Engineer Intern"], ["Databricks", "Data Science Intern"], ["Snowflake", "Software Engineer Intern"],
  ["Cloudflare", "Systems Engineer Intern"], ["Twilio", "Software Engineer Intern"], ["Block", "Software Engineer Intern"], ["Coinbase", "Security Engineer Intern"],
  ["Robinhood", "Machine Learning Engineer Intern"], ["Instacart", "Data Analyst Intern"], ["DoorDash", "Software Engineer Intern"], ["Lyft", "Product Management Intern"],
  ["Pinterest", "Software Engineer Intern"], ["Reddit", "Frontend Engineer Intern"], ["Discord", "Software Engineer Intern"], ["Duolingo", "Machine Learning Engineer Intern"],
  ["Asana", "Software Engineer Intern"], ["Atlassian", "Software Engineer Intern"], ["Okta", "Security Engineer Intern"], ["Samsara", "Software Engineer Intern"],
  ["Rippling", "Software Engineer Intern"], ["Brex", "Data Analyst Intern"], ["Scale AI", "Machine Learning Engineer Intern"], ["Anduril", "Software Engineer Intern"],
  ["Palantir", "Software Engineer Intern"], ["Bloomberg", "Software Engineer Intern"], ["Capital One", "Data Science Intern"], ["Jane Street", "Quantitative Research Intern"],
  ["Two Sigma", "Quantitative Research Intern"], ["Zillow", "Software Engineer Intern"], ["Etsy", "Data Analyst Intern"], ["Hubspot", "Software Engineer Intern"],
];

const slug = (c: string) => c.toLowerCase().replace(/[^a-z]/g, "");
const RECRUITERS = ["Jordan Lee", "Priya Nair", "Marcus Webb", "Elena Rossi", "Tomas Novak", "Aisha Khan", "Ben Carter", "Mei Tanaka"];

type Scenario = (c: Ctx) => SampleEmail[];
type Ctx = { company: string; role: string; i: number; r: () => number; ago: (d: number, h?: number) => Date; ahead: (d: number) => Date; mail: Mail; person: string };
type Mail = (thread: string, from: string, subject: string, at: Date, body: string, expected: FixtureExpectation, opts?: { outbound?: boolean; uncertain?: boolean }) => SampleEmail;

const applied = (c: Ctx, daysAgo: number): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-app`, `${c.company} Recruiting <no-reply@us.greenhouse-mail.io>`, `Thank you for applying to ${c.company}`, c.ago(daysAgo),
    `Hi Sam,\n\nThank you for applying to the ${c.role} position at ${c.company}. We received your application and will be in touch.\n`,
    { type: "applied", company: c.company, role: c.role });

const assessment = (c: Ctx, daysAgo: number, due: Date): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-oa`, "HackerRank <support@hackerrank.com>", `${c.company}: Online Assessment for ${c.role}`, c.ago(daysAgo),
    `Hi Sam,\n\n${c.company} has invited you to complete an online assessment for the ${c.role} role. Please complete it by ${longDate(due)} at 11:59 PM.\n`,
    { type: "assessment", company: c.company, role: c.role, hasDate: true });

const recruiter = (c: Ctx, daysAgo: number): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-rec`, `${c.person} <${c.person.toLowerCase().replace(/\s+/g, ".")}@${slug(c.company)}.com>`, `Internship opportunity at ${c.company}: quick chat?`, c.ago(daysAgo),
    `Hi Sam, I'm a recruiter at ${c.company}. I came across your application for the ${c.role} role and would love to set up a quick call.\n`,
    { type: "recruiter_outreach", company: c.company, role: c.role });

const reply = (c: Ctx, daysAgo: number): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-rec`, "Sam Rivera <sam.rivera@sample.invalid>", `Re: Internship opportunity at ${c.company}: quick chat?`, c.ago(daysAgo),
    "Hi, thanks for reaching out. I'm free Thursday afternoon.\n", { type: "user_reply" }, { outbound: true });

const invite = (c: Ctx, daysAgo: number): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-int`, `${c.person} <${c.person.toLowerCase().replace(/\s+/g, ".")}@${slug(c.company)}.com>`, `Next steps: schedule your interview with ${c.company}`, c.ago(daysAgo),
    `Hi Sam, we'd like to invite you to interview for the ${c.role} position. Please use the link to select a time that works for you.\n`,
    { type: "interview_invite", company: c.company, role: c.role });

const scheduled = (c: Ctx, daysAgo: number, when: Date): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-sched`, `${c.company} Recruiting <jobs@${slug(c.company)}.com>`, `Your ${c.company} interview is confirmed`, c.ago(daysAgo),
    `Your interview for the ${c.role} role is confirmed for ${longDate(when)} at 2:00 PM. You will meet with two engineers.\n`,
    { type: "interview_scheduled", company: c.company, role: c.role, hasDate: true });

const offer = (c: Ctx, daysAgo: number, by: Date): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-offer`, `${c.company} Recruiting <recruiting@${slug(c.company)}.com>`, `Your offer from ${c.company}`, c.ago(daysAgo),
    `Congratulations Sam! We are pleased to extend you an offer for the ${c.role} position at ${c.company}. Please respond by ${longDate(by)}.\n`,
    { type: "offer", company: c.company, role: c.role, hasDate: true });

const rejection = (c: Ctx, daysAgo: number): SampleEmail =>
  c.mail(`sg-${slug(c.company)}-rej`, `${c.company} Recruiting <no-reply@${slug(c.company)}.com>`, `An update on your ${c.company} application`, c.ago(daysAgo),
    `Hi Sam, unfortunately we will not be moving forward with your application for the ${c.role} role at this time.\n`,
    { type: "rejection", company: c.company, role: c.role });

/** The journeys. Each returns the emails of one opportunity. */
const SCENARIOS: Array<[string, Scenario]> = [
  ["interview-soon", (c) => [applied(c, 21), recruiter(c, 14), reply(c, 13), scheduled(c, 3, c.ahead(c.i % 3))]],
  ["interview-invite-waiting", (c) => [applied(c, 12), recruiter(c, 8), invite(c, 2 + (c.i % 3))]],
  ["assessment-due", (c) => [applied(c, 15), assessment(c, 3, c.ahead(1 + (c.i % 5)))]],
  ["assessment-overdue", (c) => [applied(c, 20), assessment(c, 9, c.ago(2))]],
  ["offer", (c) => [applied(c, 40), assessment(c, 33, c.ago(28)), scheduled(c, 20, c.ago(15)), offer(c, 2, c.ahead(4 + (c.i % 5)))]],
  ["rejected-after-assessment", (c) => [applied(c, 35), assessment(c, 28, c.ago(24)), rejection(c, 10)]],
  ["rejected-then-reapplied", (c) => [applied(c, 90), rejection(c, 70), c.mail(`sg-${slug(c.company)}-app2`, `${c.company} Recruiting <no-reply@us.greenhouse-mail.io>`, `Thank you for applying to ${c.company}`, c.ago(6),
    `Hi Sam,\n\nThank you for applying to the ${c.role} position at ${c.company}. We received your application and will be in touch.\n`, { type: "applied", company: c.company, role: c.role })]],
  ["recruiter-cold", (c) => [recruiter(c, 5 + (c.i % 3))]],
  ["ghosted", (c) => [applied(c, 26 + (c.i % 14))]],
  ["applied-recently", (c) => [applied(c, 1 + (c.i % 5))]],
  ["withdrawn", (c) => [applied(c, 30), c.mail(`sg-${slug(c.company)}-app`, "Sam Rivera <sam.rivera@sample.invalid>", `Re: Thank you for applying to ${c.company} - withdrawing my application`, c.ago(18),
    "Hi, I would like to withdraw my application as I accepted another offer.\n", { type: "withdrawn" }, { outbound: true })]],
];

/** Mail whose company the extractor cannot learn from the message: it must surface for review, not be guessed. */
function vendorUnclear(c: Ctx): SampleEmail[] {
  return [
    c.mail(`sg-vendor-${c.i}`, "Workday <noreply@myworkday.com>", "Your job application is incomplete!", c.ago(4 + (c.i % 6)),
      "Hello Sam, you started a job application but have not submitted it. Please sign in to complete your application.\n", { type: "status_update" }, { uncertain: true }),
  ];
}

const NOISE: Array<[string, string, string, number]> = [
  ["Nike <deals@nike.com>", "Our best offer: 50% off ends tonight", "Shop now and save. Unsubscribe anytime.", 2],
  ["The Daily Dev <newsletter@dailydev.io>", "Weekly digest: 10 tips for your next interview", "Read more tips on interview prep. Unsubscribe.", 3],
  ["Google <no-reply@accounts.google.com>", "Security alert", "A new sign-in was detected.", 4],
  ["Chase <alerts@chase.com>", "Your statement is ready", "View your statement.", 6],
  ["Handshake <noreply@joinhandshake.com>", "Boost your career: new internship alerts for you", "Jobs picked for you this week. Unsubscribe or manage your email preferences.", 5],
  ["LinkedIn <jobs-noreply@linkedin.com>", "Your job alert: Software Engineer Intern", "New jobs match your search. Manage alerts or unsubscribe.", 7],
  ["Coursera <hello@coursera.org>", "Next steps for your application to the data course", "Complete your enrollment today. Unsubscribe.", 9],
  ["Amazon <store-news@amazon.com>", "Deals for you: offer ends soon", "Limited-time offer on electronics. Unsubscribe.", 11],
];

/** Whole mailbox, oldest first. `anchor` is "today"; ids are stable for a given anchor. */
export function buildSampleMailbox(anchor: Date): SampleEmail[] {
  const day0 = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const ago = (d: number, h = 10) => new Date(day0 - d * DAY + h * 3_600_000);
  const ahead = (d: number) => new Date(day0 + d * DAY);
  let n = 0;
  const mail: Mail = (thread, from, subject, at, body, expected, opts = {}) => ({
    email: { id: `sample-${++n}`, threadId: thread, from, subject, receivedAt: at, outbound: opts.outbound ?? false, bodyText: body },
    expected,
    ...(opts.uncertain ? { uncertain: true } : {}),
  });
  const r = rng(20261108);
  const out: SampleEmail[] = buildDemoMailbox(anchor); // the hand-written core (ids demo-*)
  COMPANIES.forEach(([company, role], i) => {
    const ctx: Ctx = { company, role, i, r, ago, ahead, mail, person: RECRUITERS[i % RECRUITERS.length] };
    const [, scenario] = SCENARIOS[i % SCENARIOS.length];
    out.push(...scenario(ctx));
    if (i % 9 === 4) out.push(...vendorUnclear(ctx));
  });
  // Known extractor false positive kept on purpose: course-enrollment mail that borrows hiring words. It is flagged uncertain so
  // tests do not pretend the extractor handles it, and the product's review queue is the place a user would catch it.
  const KNOWN_HARD = /data course/;
  NOISE.forEach(([from, subject, body, d], i) => out.push(mail(`sg-noise-${i}`, from, subject, ago(d), body, { type: null }, { uncertain: KNOWN_HARD.test(subject) })));
  return out.sort((a, b) => a.email.receivedAt.getTime() - b.email.receivedAt.getTime());
}

export const sampleEmails = (anchor: Date): RecruitingEmail[] => buildSampleMailbox(anchor).map((x) => x.email);
