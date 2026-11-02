import { buildActions } from "./actions.ts";
import { extractAll } from "./extract.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { RecruitingEmail } from "./types.ts";

/**
 * Synthetic mailbox for the presentation route. Every company, person and email here is fictional.
 * It runs through the real extraction/grouping/action code, so the demo shows genuine product output.
 * Time is pinned (never the real clock) so every replay is identical.
 */
const DAY = 86_400_000;
/** Monday, November 2, 2026, 8:12 AM (floating). */
export const PRESENTATION_NOW = new Date(Date.UTC(2026, 10, 2, 8, 12));
const day0 = Date.UTC(2026, 10, 2);

/** Date at `offset` days from "today", at `hour` (fractional). */
const at = (offset: number, hour = 9) => new Date(day0 + offset * DAY + Math.round(hour * 3_600_000));

let seq = 0;
function mail(
  threadId: string,
  from: string,
  subject: string,
  when: Date,
  bodyText: string,
  outbound = false,
): RecruitingEmail {
  seq += 1;
  return { id: `pres-${seq}`, threadId, from, subject, receivedAt: when, outbound, bodyText };
}

const ME = "Maya Hart <maya.hart@example.com>";

function applied(thread: string, company: string, domain: string, role: string, daysAgo: number) {
  return mail(
    thread,
    `${company} Recruiting <careers@${domain}>`,
    `Thank you for applying to ${company}`,
    at(-daysAgo, 10),
    `Hi Maya,\n\nThank you for applying to the ${role} position at ${company}. We received your application and will be in touch.\n`,
  );
}

export function buildPresentationMailbox(): RecruitingEmail[] {
  seq = 0;
  const bw = { c: "Brightwater Labs", d: "brightwaterlabs.com", r: "Software Engineering Intern (Summer 2027)" };
  const kr = { c: "Kestrel Robotics", d: "kestrelrobotics.com", r: "Robotics Software Engineer Intern (Summer 2027)" };
  const priya = `Priya Natarajan <priya.natarajan@${bw.d}>`;
  const daniel = `Daniel Okafor <daniel.okafor@${kr.d}>`;

  return [
    // --- Brightwater Labs: the hero. Applied -> assessment -> recruiter -> interview (Wed Nov 4, 2:00 PM)
    applied("bw-1", bw.c, bw.d, bw.r, 32),
    mail("bw-2", `${bw.c} Recruiting <careers@${bw.d}>`, "Your online assessment", at(-27, 9),
      "Hi Maya,\n\nPlease complete the online assessment by October 10, 2026 at 11:59 PM. It takes about 90 minutes.\n"),
    mail("bw-3", `${bw.c} Recruiting <careers@${bw.d}>`, "Thanks for completing your assessment", at(-24, 14),
      "Thank you for completing the assessment. Our team will review your results.\n"),
    mail("bw-4", priya, "Quick chat?", at(-19, 11),
      `Hi Maya, I'm a recruiter at ${bw.c}. I came across your application for the Software Engineering Intern role and would love to set up a quick call.\n`),
    mail("bw-4", ME, "Re: Quick chat?", at(-19, 15), "Hi Priya, thanks for reaching out. I'm free Thursday afternoon.\n", true),
    mail("bw-5", priya, "Schedule your interview", at(-7, 10),
      "Hi Maya, we'd like to move you to the next round. Please select a time that works for you using the link below.\n"),
    mail("bw-6", priya, "Your interview is confirmed", at(-5, 13),
      `Your interview for the Software Engineering Intern role is confirmed for November 4, 2026 at 2:00 PM. You will meet with Priya Natarajan and one engineer.\n`),

    // --- Kestrel Robotics: the rich one. Twelve emails, one story, ending in an offer.
    applied("kr-1", kr.c, kr.d, kr.r, 49),
    mail("kr-2", `${kr.c} Recruiting <careers@${kr.d}>`, "Your coding challenge", at(-45, 9),
      "Hi Maya,\n\nPlease complete the coding challenge by September 22, 2026.\n"),
    mail("kr-2", `${kr.c} Recruiting <careers@${kr.d}>`, "Reminder: your coding challenge closes tomorrow", at(-42, 9),
      "Your coding challenge link closes tomorrow.\n"),
    mail("kr-3", `${kr.c} Recruiting <careers@${kr.d}>`, "Thanks for completing your coding challenge", at(-41, 16),
      "Thank you for completing the challenge. We'll be in touch.\n"),
    mail("kr-4", daniel, "Let's talk", at(-38, 10),
      `Hi Maya, I'm a recruiter at ${kr.c}. Your background caught my eye and I'd like a quick call about the Robotics Software Engineer Intern role.\n`),
    mail("kr-4", ME, "Re: Let's talk", at(-38, 14), "Hi Daniel, happy to talk. Does Friday work?\n", true),
    mail("kr-5", daniel, "Schedule your interview", at(-34, 10),
      "Hi Maya, please select a time for your interview using the link below.\n"),
    mail("kr-6", daniel, "Your interview is confirmed", at(-32, 11),
      "Your interview is confirmed for October 8, 2026 at 10:00 AM.\n"),
    mail("kr-7", daniel, "Your interview is confirmed for a new time", at(-27, 9),
      "Your interview has been moved to October 9, 2026 at 3:30 PM. Sorry for the change.\n"),
    mail("kr-7", ME, "Re: Your interview is confirmed for a new time", at(-27, 12), "That works, thank you.\n", true),
    mail("kr-8", `${kr.c} Recruiting <careers@${kr.d}>`, "Your offer letter", at(-12, 10),
      "Congratulations Maya! We are pleased to extend you an offer for the Robotics Software Engineer Intern role. Please respond by November 6, 2026.\n"),
    mail("kr-9", `${kr.c} Recruiting <careers@${kr.d}>`, "Updated offer letter", at(-3, 9),
      "Attached is your updated offer letter for the Robotics Software Engineer Intern role. Please respond by November 6, 2026.\n"),

    // --- Lumora Health: assessment due Thursday
    applied("lh-1", "Lumora Health", "lumorahealth.com", "Clinical Data Analyst Intern", 25),
    mail("lh-2", "Lumora Health Recruiting <careers@lumorahealth.com>", "Lumora Health: online assessment for the Clinical Data Analyst Intern role", at(-4, 9),
      "Hi Maya,\n\nPlease complete the online assessment by November 5, 2026 at 11:59 PM.\n"),

    // --- Halcyon Cloud: assessment due Sunday
    applied("hc-1", "Halcyon Cloud", "halcyoncloud.com", "Platform Engineer Intern", 18),
    mail("hc-2", "Halcyon Cloud Recruiting <careers@halcyoncloud.com>", "Your online assessment", at(-3, 9),
      "Hi Maya,\n\nPlease complete the online assessment by November 8, 2026 at 11:59 PM.\n"),

    // --- Fable Analytics: interview a week out
    applied("fa-1", "Fable Analytics", "fableanalytics.com", "Machine Learning Engineer Intern", 28),
    mail("fa-2", "Fable Analytics Talent <talent@fableanalytics.com>", "Your interview is confirmed", at(-5, 10),
      "Your interview for the Machine Learning Engineer Intern role is confirmed for November 9, 2026 at 11:00 AM.\n"),

    // --- Orchard & Vale: interview next week
    applied("ov-1", "Orchard & Vale", "orchardvale.com", "Product Designer Intern", 30),
    mail("ov-2", "Orchard & Vale Talent <talent@orchardvale.com>", "Your Orchard & Vale interview is confirmed", at(-6, 10),
      "Your interview for the Product Designer Intern role is confirmed for November 11, 2026 at 1:00 PM.\n"),

    // --- Meridian Forge: recruiter reached out, you replied
    mail("mf-1", "Tomás Herrera <tomas.herrera@meridianforge.com>", "Meridian Forge: Platform Engineer Intern", at(-3, 10),
      "Hi Maya, I'm a recruiter at Meridian Forge. I came across your application for the Platform Engineer Intern role and would love a quick call.\n"),
    mail("mf-1", ME, "Re: Meridian Forge: Platform Engineer Intern", at(-2, 9), "Hi Tomás, I'd love that. Tuesday morning?\n", true),

    // --- Applied, quiet
    applied("jr-1", "Juniper Row", "juniperrow.com", "Data Analyst Intern", 21),
    applied("pe-1", "Pinecrest Energy", "pinecrestenergy.com", "Software Engineer Intern", 26),
    applied("lg-1", "Larkspur Games", "larkspurgames.com", "Gameplay Engineer Intern", 33),
    applied("tw-1", "Tidewell Systems", "tidewellsystems.com", "Backend Engineer Intern", 24),
    applied("qb-1", "Quillmark Bio", "quillmarkbio.com", "Research Associate Intern", 12),
    applied("sm-1", "Sundial Mobility", "sundialmobility.com", "Software Engineer Intern", 10),

    // --- Closed: a rejection last week
    applied("rb-1", "Ravenmoor Bio", "ravenmoorbio.com", "Lab Software Engineer Intern", 31),
    mail("rb-2", "Ravenmoor Bio Recruiting <careers@ravenmoorbio.com>", "An update on your Ravenmoor Bio application", at(-6, 10),
      "Hi Maya, after careful consideration we have decided to pursue other candidates for the Lab Software Engineer Intern role at this time.\n"),
  ];
}

export function buildPresentationWorkspace() {
  const emails = buildPresentationMailbox();
  const events = extractAll(emails).map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
  const opportunities = buildOpportunities(events);
  const actions = buildActions(opportunities, PRESENTATION_NOW);
  const byCompany = (name: string) => opportunities.find((o) => o.company === name)!;
  return {
    now: PRESENTATION_NOW,
    emailCount: emails.length,
    opportunities,
    actions,
    heroKey: byCompany("Brightwater Labs").key,
    historyKey: byCompany("Kestrel Robotics").key,
  };
}
