import { GUIDE_V2, OUTPUT_SPEC, READER_SCHEMA_VERSION, sha } from "./guide.ts";

/**
 * Classification guide v3: the same instructions as v2 with the product's recruiting SCOPE made explicit (decided
 * 2026-11-08). Only the "Is it recruiting?" section changes; type, stage, company, role and the output spec are v2's,
 * so verification and the output format are unchanged. v2 stays untouched so the frozen candidate remains reproducible.
 *
 * Scope: employment, internship and contract hiring processes, including the pre-start steps that complete the hire.
 * Courses, scholarships, bootcamps, hackathons, generic programs and other non-employment opportunities are NOT
 * recruiting here. (A future, separate `program_opportunity` category is designed in docs/architecture-v2-shadow.md and
 * deliberately not mixed into recruiting.)
 */
const RECRUITING_SECTION = `## Is it recruiting?
recruiting = "yes" ONLY if the email is genuinely part of THIS person's process of being hired into a job, internship or paid contract or project, or is direct outreach to them from an employer or recruiter offering one:
 - application confirmations, recruiter outreach to the person, assessments or coding challenges for a role, interview invitations or scheduling, offers, rejections, "position filled" or "no longer reviewing" notices tied to their application, withdrawals, and status updates about their application;
 - a reminder SPECIFICALLY tied to the recipient's existing or started application (for example "you started your application but have not submitted it", "your application is due tomorrow");
 - candidacy for paid gig, contract or project work;
 - pre-start steps that complete the hire, before the job begins: background screening requested by the employer, employment-eligibility paperwork, offer or onboarding paperwork, pre-employment screening, start-date confirmation;
 - portal or access-code messages ONLY when the visible message ties them to a specific application or hiring process.
recruiting = "no" for: courses, bootcamps, training programs, cohorts and community programs, even when they use words like application, interview, assessment, acceptance or next steps; scholarships, prizes, honor societies, school admissions, and fellowships that are training or awards rather than employment; hackathons, conferences, webinars and other events; job-alert digests ("new jobs for you"), newsletters, ads and talent-community marketing; generic "applications are open", "applications close soon" or "remember to apply" broadcasts addressed to everyone; administration of a job the person has ALREADY started (orientation or kickoff sessions, equipment, payroll, benefits, rewards, timekeeping, work-authorization paperwork for a current role); receipts, account or security codes with no visible tie to a hiring process; mail that is not about this person's own process (for example someone else's forwarded message).
Classify by the actual content, not by subject wording: an "Application Update" subject that really announces a course or event is "no".

`;

const START = "## Is it recruiting?";
const END = "## Type";
const a = GUIDE_V2.indexOf(START);
const b = GUIDE_V2.indexOf(END);
if (a < 0 || b < a) throw new Error("guide v2 layout changed; update guide3.ts");

export const GUIDE_V3 = GUIDE_V2.slice(0, a).replace("Classification guide v2", "Classification guide v3") + RECRUITING_SECTION + GUIDE_V2.slice(b);
export const GUIDE_HASH_V3 = sha(GUIDE_V3 + OUTPUT_SPEC).slice(0, 12);
/** Identifies what produces a shadow model read; stored on every shadow row. */
export const READER_VERSION_V3 = `reader-s${READER_SCHEMA_VERSION}-g${GUIDE_HASH_V3}`;
