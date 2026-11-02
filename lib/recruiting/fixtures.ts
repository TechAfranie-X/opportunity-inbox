import type { EventType, RecruitingEmail } from "./types.ts";

/**
 * Synthetic mailbox used by (a) unit tests, (b) the extraction-accuracy eval,
 * and (c) the /demo route. It contains no real people or real messages.
 * All dates are relative to `now` so the demo always looks current.
 */
export type FixtureExpectation = {
  type: EventType | null; // null = should NOT be extracted (noise)
  company?: string;
  role?: string;
  hasDate?: boolean;
};

export type FixtureEmail = { email: RecruitingEmail; expected: FixtureExpectation };

const DAY = 86_400_000;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function longDate(d: Date) {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function buildDemoMailbox(now: Date): FixtureEmail[] {
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ago = (days: number, hour = 10) => new Date(day0 - days * DAY + hour * 3_600_000);
  const ahead = (days: number) => new Date(day0 + days * DAY);
  let n = 0;
  const mail = (
    threadId: string,
    from: string,
    subject: string,
    receivedAt: Date,
    bodyText: string,
    expected: FixtureExpectation,
    outbound = false,
  ): FixtureEmail => ({
    email: { id: `demo-${++n}`, threadId, from, subject, receivedAt, outbound, bodyText },
    expected,
  });

  const oaDue = ahead(2);
  const interviewDay = ahead(1);
  const offerBy = ahead(4);

  return [
    // --- Stripe: applied -> OA due in 2 days
    mail("t-stripe", "Stripe Recruiting <no-reply@us.greenhouse-mail.io>",
      "Thank you for applying to Stripe", ago(35),
      "Hi Sam,\n\nThank you for applying to the Software Engineer Intern position at Stripe. We received your application and will be in touch.\n",
      { type: "applied", company: "Stripe", role: "Software Engineer Intern" }),
    mail("t-stripe-oa", "HackerRank <support@hackerrank.com>",
      "Stripe: Online Assessment for Software Engineer Intern", ago(5),
      `Hi Sam,\n\nStripe has invited you to complete an online assessment for the Software Engineer Intern role. Please complete it by ${longDate(oaDue)} at 11:59 PM.\n`,
      { type: "assessment", company: "Stripe", role: "Software Engineer Intern", hasDate: true }),

    // --- Datadog: applied, recruiter, user reply, interview invite waiting
    mail("t-dd", "Datadog Careers <careers@datadoghq.com>",
      "We received your application", ago(20),
      "Thanks for applying for the Backend Engineer Intern role at Datadog. We received your application.\n",
      { type: "applied", company: "Datadog", role: "Backend Engineer Intern" }),
    mail("t-dd-rec", "Maya Chen <maya.chen@datadoghq.com>",
      "Datadog Backend Engineer Intern - quick chat?", ago(12),
      "Hi Sam, I'm a recruiter at Datadog. I came across your application for the Backend Engineer Intern role and would love to set up a quick call.\n",
      { type: "recruiter_outreach", company: "Datadog", role: "Backend Engineer Intern" }),
    mail("t-dd-rec", "Sam Rivera <sam@example.com>",
      "Re: Datadog Backend Engineer Intern - quick chat?", ago(11),
      "Hi Maya, thanks for reaching out. I'm free Thursday afternoon.\n",
      { type: "user_reply" }, true),
    mail("t-dd-int", "Maya Chen <maya.chen@datadoghq.com>",
      "Next steps: schedule your interview with Datadog", ago(3),
      "Hi Sam, we'd like to invite you to interview for the Backend Engineer Intern position. Please use the link to select a time that works for you.\n",
      { type: "interview_invite", company: "Datadog", role: "Backend Engineer Intern" }),

    // --- Notion: applied -> OA -> done -> interview tomorrow
    mail("t-notion", "Notion Recruiting <jobs@notion.so>",
      "Your application to Notion", ago(40),
      "Thanks for applying to the Software Engineer Intern position at Notion. Your application has been received.\n",
      { type: "applied", company: "Notion", role: "Software Engineer Intern" }),
    mail("t-notion-oa", "CodeSignal <noreply@codesignal.com>",
      "Notion: complete your coding assessment", ago(30),
      `Notion invited you to complete a coding assessment for the Software Engineer Intern role. Complete it by ${longDate(ahead(-24))}.\n`,
      { type: "assessment", company: "Notion", role: "Software Engineer Intern", hasDate: true }),
    mail("t-notion-oa2", "CodeSignal <noreply@codesignal.com>",
      "Thanks for completing your Notion assessment", ago(26),
      "Thank you for completing the coding assessment for Notion. Your submission has been received.\n",
      { type: "assessment_completed", company: "Notion" }),
    mail("t-notion-int", "Notion Recruiting <jobs@notion.so>",
      "Your Notion interview is confirmed", ago(4),
      `Your interview for the Software Engineer Intern role is confirmed for ${longDate(interviewDay)} at 2:00 PM. You will meet with two engineers.\n`,
      { type: "interview_scheduled", company: "Notion", role: "Software Engineer Intern", hasDate: true }),

    // --- Airbnb: applied, silence
    mail("t-airbnb", "Airbnb Recruiting <no-reply@airbnb.com>",
      "Application received: Data Analyst Intern", ago(25),
      "Thank you for applying to the Data Analyst Intern position at Airbnb. We received your application.\n",
      { type: "applied", company: "Airbnb", role: "Data Analyst Intern" }),

    // --- Roblox: rejection
    mail("t-roblox", "Roblox Recruiting <no-reply@roblox.com>",
      "Thank you for applying to Roblox", ago(30),
      "Thanks for applying to the Software Engineer Intern role at Roblox. We received your application.\n",
      { type: "applied", company: "Roblox", role: "Software Engineer Intern" }),
    mail("t-roblox2", "Roblox Recruiting <no-reply@roblox.com>",
      "An update on your Roblox application", ago(9),
      "Hi Sam, unfortunately we will not be moving forward with your application for the Software Engineer Intern role at this time.\n",
      { type: "rejection", company: "Roblox", role: "Software Engineer Intern" }),

    // --- Ramp: offer with deadline
    mail("t-ramp", "Ramp Recruiting <recruiting@ramp.com>",
      "Your offer from Ramp", ago(1),
      `Congratulations Sam! We are pleased to extend you an offer for the Software Engineer Intern position at Ramp. Please respond by ${longDate(offerBy)}.\n`,
      { type: "offer", company: "Ramp", role: "Software Engineer Intern", hasDate: true }),

    // --- Cold recruiter outreach, yesterday
    mail("t-vercel", "Jane Park <jane.park@vercel.com>",
      "Frontend Engineer Intern at Vercel", ago(1, 15),
      "Hi Sam, I'm a recruiter at Vercel. I came across your profile and your background looks great for our Frontend Engineer Intern role. Open to a quick chat?\n",
      { type: "recruiter_outreach", company: "Vercel", role: "Frontend Engineer Intern" }),

    // --- Noise (must NOT be extracted)
    mail("n1", "Nike <deals@nike.com>", "Our best offer: 50% off ends tonight", ago(2),
      "Shop now and save. Unsubscribe anytime.\n", { type: null }),
    mail("n2", "The Daily Dev <newsletter@dailydev.io>", "Weekly digest: 10 tips for your next interview", ago(3),
      "Read more tips on interview prep.\n", { type: null }),
    mail("n3", "Google <no-reply@accounts.google.com>", "Security alert", ago(4),
      "A new sign-in was detected.\n", { type: null }),
    mail("n4", "Chase <alerts@chase.com>", "Your statement is ready", ago(6),
      "View your statement.\n", { type: null }),
  ];
}
