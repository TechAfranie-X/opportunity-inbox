import type { RecruitingEmail } from "../types.ts";

/**
 * Out-of-distribution stress cases for the recruiting readers. SYNTHETIC: hand-written, fictional employers and
 * programs, no real email text. They are regression and stress fixtures for development, not a validation set, and no
 * claim about real-world accuracy may be drawn from them.
 *
 * Labels follow guide v2 plus the precedents set when labeling real mail:
 *  - yes: part of THIS person's hiring process, including steps required to complete a hire before it starts
 *    (background screening, employment-eligibility paperwork, offer paperwork).
 *  - no: course, bootcamp, cohort or school-admission mail (even when it says "interview" or "assessment"), employer
 *    marketing, and administration of a job the person already started (orientation, equipment, payroll, rewards).
 *
 * The classes are the failure families of the held-out evaluation, restated generically:
 *  program   - non-employment program mail written in hiring vocabulary
 *  postoffer - hiring-completion steps phrased without application vocabulary
 *  employed  - administration of an already-started job (not recruiting)
 *  market    - marketing that borrows career words
 *  core      - ordinary recruiting mail, as controls
 */
export type StressCase = { id: string; cls: "program" | "postoffer" | "employed" | "market" | "core"; yes: boolean; from: string; subject: string; body: string };

const C = (id: string, cls: StressCase["cls"], yes: boolean, from: string, subject: string, body: string): StressCase => ({ id, cls, yes, from, subject, body });

export const STRESS_SET: StressCase[] = [
  // program: hiring-style words, but a course / cohort / school, so NOT recruiting
  C("p1", "program", false, "CodeBridge Academy <admissions@codebridge.example>", "Your interview is confirmed", "Hi Sam, your admissions interview for the Spring cohort is confirmed for Tuesday at 3 PM. Please join the video call a few minutes early. Our team looks forward to meeting you."),
  C("p2", "program", false, "CodeBridge Academy <admissions@codebridge.example>", "Complete your readiness assessment by May 3", "Thank you for applying to the Advanced Cloud course. To stay in consideration for a seat in the cohort, finish your readiness assessment by May 3. Seats are limited."),
  C("p3", "program", false, "CodeBridge Academy <support@codebridge.example>", "Update on your capstone application", "Thanks for applying to the Open Source Capstone. We are unable to offer you a live seat this term, but we can offer observer access to the recorded sessions and course materials."),
  C("p4", "program", false, "Lumen Bootcamp <hello@lumenbootcamp.example>", "Next steps for your enrollment", "Congratulations on your acceptance to the Data Analytics bootcamp. Next steps: sign the enrollment agreement and schedule your onboarding call with the student success team."),
  C("p5", "program", false, "Greenway Community Fund <grants@greenway.example>", "Scholarship application received", "We received your application for the Greenway Student Scholarship. Recipients will be notified by June 1. Thank you for applying."),
  C("p6", "program", false, "Pinecrest University Honors <honors@pinecrest.example>", "You are invited to join the honor society", "Your academic record makes you eligible for invitation. Accept your invitation by Friday to be inducted at the fall ceremony."),
  C("p7", "program", false, "Skillshare Guild <events@skillguild.example>", "Mock interview night: reserve your spot", "Join our community mock interview night. Practice with volunteers and get feedback. Register today; spaces are limited."),
  C("p8", "program", false, "Hackathon Hub <team@hackhub.example>", "Your hackathon team assessment is ready", "Complete the team skills assessment so we can pair you with teammates before the weekend event. Prizes include gift cards."),
  // postoffer: steps that complete a hire, with no application vocabulary
  C("o1", "postoffer", true, "ScreenRight Verifications <noreply@screenright.example>", "Action needed: background screening for Northwind Labs", "Northwind Labs has asked us to complete a background screening for your employment. Please use the secure link to provide the information we need within 3 business days."),
  C("o2", "postoffer", true, "ScreenRight Verifications <noreply@screenright.example>", "Additional information required for your screening", "We still need one more document to complete the screening requested by Northwind Labs. Please sign in and upload it today."),
  C("o3", "postoffer", true, "People Team <people@northwindlabs.example>", "Complete your employment eligibility form before day one", "Welcome to the team. Before your first day, please complete Section 1 of the employment eligibility verification form in the onboarding portal. A representative will review your documents on or after your start date."),
  C("o4", "postoffer", true, "Northwind Labs HR <hr@northwindlabs.example>", "Your signed offer paperwork", "Thanks for returning your signed paperwork. We have everything we need and will send your start date logistics next week."),
  C("o5", "postoffer", true, "Contoso Talent <talent@contoso.example>", "Please confirm your start date", "We are delighted that you accepted. Please reply to confirm that Monday, June 9 works as your start date, and we will schedule your orientation."),
  C("o6", "postoffer", true, "OnboardFlow <no-reply@onboardflow.example>", "Fabrikam: finish your new hire tasks", "Fabrikam has assigned you new hire tasks: tax forms, direct deposit and policy acknowledgements. Complete them before your first day."),
  C("o7", "postoffer", true, "Medical Screening Partners <schedule@medscreen.example>", "Schedule your pre-employment screening", "As part of your offer from Fabrikam, please schedule a pre-employment screening appointment at one of our partner locations."),
  C("o8", "postoffer", true, "Fabrikam University Recruiting <campus@fabrikam.example>", "Reminder: respond to your offer by Friday", "This is a friendly reminder that your internship offer expires on Friday. Please accept or decline in the portal."),
  // employed: administration of a job already started, so NOT recruiting
  C("e1", "employed", false, "Northwind Labs IT <helpdesk@northwindlabs.example>", "Your laptop order has shipped", "Your equipment order is on its way. Tracking details are below. Contact the service desk if it has not arrived by Friday."),
  C("e2", "employed", false, "Northwind Interns <interns@northwindlabs.example>", "Welcome session: timekeeping and Slack basics", "Kick off the summer with our welcome session. We cover how to record your hours and where to find help. Join on Teams."),
  C("e3", "employed", false, "Payroll Services <payroll@northwindlabs.example>", "Your first pay statement is available", "Your pay statement for the period ending the 15th is ready to view in the portal."),
  C("e4", "employed", false, "Global Mobility <mobility@northwindlabs.example>", "Documentation for your school", "To support your work authorization for school, please complete the form below: school name, degree program, enrollment dates and weekly hours."),
  C("e5", "employed", false, "Rewards Portal <noreply@recognition.example>", "Congratulations on your reward", "Your recognition points order is being processed. View order status in the rewards portal."),
  C("e6", "employed", false, "Northwind Labs Benefits <benefits@northwindlabs.example>", "Open enrollment starts Monday", "Employees can update their benefit elections from Monday through the 30th. Review the plan guide before choosing."),
  // market: marketing that borrows career words
  C("m1", "market", false, "ResumeGlow <offers@resumeglow.example>", "Land your dream job: 50% off resume review", "Your next interview starts here. Get 50% off our professional resume review this week only. Use code CAREER50 at checkout."),
  C("m2", "market", false, "Credit Union Rewards <news@cu.example>", "Apply now for a card with 3% cash back", "Apply today and get a limited-time offer. Terms apply. Unsubscribe at any time."),
  C("m3", "market", false, "JobPulse Digest <digest@jobpulse.example>", "12 new jobs for you this week", "Software Engineer at Acme, Data Analyst at Globex, and more. Apply now before they fill. Manage your email preferences."),
  C("m4", "market", false, "Contoso Careers <marketing@contoso.example>", "Join our talent community", "Stay in touch with Contoso. Get news about openings, events and career tips. Sign up to receive updates."),
  C("m5", "market", false, "Campus Perks <hello@campusperks.example>", "Internship season savings", "Student deals this week: laptops, coffee and more. Offer ends Sunday."),
  C("m6", "market", false, "Contoso Events <events@contoso.example>", "Join us for our virtual career fair", "Meet employer teams at the Contoso virtual career fair on October 12. Register to attend."),
  // core: ordinary recruiting mail
  C("c1", "core", true, "Greenhouse <no-reply@greenhouse.io>", "Thank you for applying to Globex", "Thank you for applying to the Software Engineer Intern position at Globex. We have received your application and will be in touch if there is a match."),
  C("c2", "core", true, "Globex Recruiting <recruiting@globex.example>", "Next steps: schedule your interview", "Hi Sam, we would like to invite you to interview for the Software Engineer Intern role. Please choose a time using the link below."),
  C("c3", "core", true, "Lever <no-reply@hire.lever.co>", "An update on your application to Initech", "Thank you for your interest in Initech. After careful review we have decided to move forward with other candidates. We wish you the best."),
  C("c4", "core", true, "CodeSignal <no-reply@codesignal.com>", "Your assessment for Hooli", "Hooli invited you to complete a coding assessment. You have 70 minutes once you begin. Start before the link expires on Friday."),
  C("c5", "core", true, "Ariel Park <ariel.park@vandelay.example>", "Software engineering opportunities at Vandelay", "Hi Sam, I am a recruiter at Vandelay Industries and came across your profile. We are hiring new graduate engineers. Would you have time for a quick call this week?"),
  C("c6", "core", true, "Workday <donotreply@myworkday.com>", "Your application to Umbrella Corp was submitted", "Your application for the Data Analyst role at Umbrella Corp has been submitted. You can review its status in your candidate home."),
  C("c7", "core", true, "Initech Talent <talent@initech.example>", "Offer of employment", "We are pleased to offer you the position of Associate Engineer. Your offer letter is attached; please review and respond within five business days."),
  C("c8", "core", true, "Soylent Recruiting <jobs@soylent.example>", "Interview confirmed: Thursday 2 PM", "This confirms your interview for the Product Analyst Intern position on Thursday at 2 PM with the hiring manager. A video link is below."),
  C("c9", "core", false, "Amazon <store-news@amazon.example>", "Deals for you", "Today's deals on electronics and home. Limited time offers. Unsubscribe."),
  C("c10", "core", false, "Streamly <no-reply@streamly.example>", "Your password was changed", "The password for your account was recently changed. If this was not you, contact support."),
];

export const stressEmail = (c: StressCase): RecruitingEmail => ({
  id: `stress-${c.id}`, threadId: `stress-t-${c.id}`, from: c.from, subject: c.subject, receivedAt: new Date("2026-03-10T15:00:00Z"), outbound: false, bodyText: c.body,
});
