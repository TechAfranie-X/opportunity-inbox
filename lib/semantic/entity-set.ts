import type { RecruitingEmail } from "../recruiting/types.ts";

/**
 * A fresh SYNTHETIC evaluation set for entity understanding (written for this milestone; contains no real mail). It was written to stress the
 * structure the deterministic rules cannot see: the employer named only in the body, a sender that is a vendor or an agency, assessment mail
 * whose sender line carries a recruiting-team name, generic or look-alike domains, and non-recruiting mail that names companies. Truth is what a
 * careful person would say. It was NOT used to tune any rule or guide. `employer: null` means a careful person could not name the employer.
 */
export type EntityCase = {
  id: string;
  group: string;
  from: string;
  subject: string;
  body: string;
  truth: { recruiting: boolean; employer: string | null; role: string | null; type: string | null };
};

const g = (group: string, id: string, from: string, subject: string, body: string, employer: string | null, role: string | null, type: string | null, recruiting = true): EntityCase => ({ id, group, from, subject, body, truth: { recruiting, employer, role, type } });
const non = (group: string, id: string, from: string, subject: string, body: string): EntityCase => g(group, id, from, subject, body, null, null, null, false);

const GH = "Talent Team <no-reply@us.greenhouse-mail.io>";
const LV = "Hiring Team <no-reply@hire.lever.co>";

export const ENTITY_CASES: EntityCase[] = [
  // Employer only in the body; the sender is an applicant tracking system
  g("body-only", "b1", GH, "Update on your application", "Hi Sam, thank you for applying for the Software Engineer Intern position at Lyft. We would like to invite you to a recruiter screen. Please reply with your availability this week.", "Lyft", "Software Engineer Intern", "interview_invite"),
  g("body-only", "b2", GH, "Your application", "Thank you for your interest in Neuralink. We received your application for the Software Engineering Intern role and our team will review it carefully.", "Neuralink", "Software Engineering Intern", "applied"),
  g("body-only", "b3", LV, "We received your application", "Hello Sam, your application to Anduril for the Embedded Software Intern role has been received. We will be in touch if there is a match.", "Anduril", "Embedded Software Intern", "applied"),
  g("body-only", "b4", GH, "Next steps", "Good news, Sam. After reviewing your background the Waymo recruiting team would like to set up a 30 minute introductory call. Please pick a time that works for you.", "Waymo", null, "recruiter_outreach"),
  g("body-only", "b5", LV, "Thank you for applying", "We are sorry to let you know that Plaid has decided not to move forward with your application for the Data Science Intern role at this time.", "Plaid", "Data Science Intern", "rejection"),
  g("body-only", "b6", "Recruiting <jobs@smartrecruiters.com>", "Your application status", "Dear Sam, Brex has completed its review of your application for Backend Engineer Intern. Unfortunately we will not be moving forward.", "Brex", "Backend Engineer Intern", "rejection"),
  g("body-only", "b7", GH, "Confirming your interview", "Hi Sam, this confirms your interview with Scale AI on Thursday, November 19 at 1:00 PM Pacific for the Machine Learning Intern position. A calendar invite will follow.", "Scale AI", "Machine Learning Intern", "interview_scheduled"),
  g("body-only", "b8", "Candidate Experience <notifications@myworkday.com>", "Application received", "Thank you for submitting your application to Ramp for the Software Engineer Intern (Summer 2027) role. We review applications on a rolling basis.", "Ramp", "Software Engineer Intern", "applied"),
  // Assessment vendors and recruiting-team sender names
  g("assessment-vendor", "a1", "Everpure Recruiting <no-reply@hackerrank.com>", "Everpure Recruiting: Your HackerRank Early Career Coding Challenge Invitation", "Hi Sam, Everpure has invited you to complete the Early Career Coding Challenge. The test is 90 minutes and must be completed within 7 days. Start the challenge from your HackerRank dashboard.", "Everpure", null, "assessment"),
  g("assessment-vendor", "a2", "CodeSignal <invites@codesignal.com>", "Your invitation to complete an assessment", "You have been invited to take a General Coding Assessment on CodeSignal. Complete it by November 20 at 11:59 PM. Good luck!", null, null, "assessment"),
  g("assessment-vendor", "a3", "Codility <no-reply@codility.com>", "Vercel online test: Frontend Engineer Intern", "Vercel has invited you to take an online coding test for the Frontend Engineer Intern role. You have until Friday to start.", "Vercel", "Frontend Engineer Intern", "assessment"),
  g("assessment-vendor", "a4", "HackerRank Tests <support@hackerrank.com>", "Reminder: your test expires soon", "This is a reminder that your assessment for Datadog expires in 24 hours. Please complete the Software Engineer Intern coding test before then.", "Datadog", "Software Engineer Intern", "assessment"),
  g("assessment-vendor", "a5", "HireVue <noreply@hirevue.com>", "Complete your video interview", "You have been asked to record a video interview for Roblox. The interview closes on November 18. It should take about 25 minutes.", "Roblox", null, "assessment"),
  g("assessment-vendor", "a6", "Pymetrics <hello@pymetrics.ai>", "Your next step", "Your next step in the application process is a short set of online games. It takes about 25 minutes. You should receive results within a few days.", null, null, "assessment"),
  // Staffing and recruiting agencies
  g("agency", "g1", "Dana Reyes <dana@talentbridge-staffing.com>", "Opportunity: Data Analyst Intern", "Hi Sam, I am a recruiter at TalentBridge Staffing. We are recruiting on behalf of our client Stripe for a Data Analyst Intern role. Are you open to a quick chat?", "Stripe", "Data Analyst Intern", "recruiter_outreach"),
  g("agency", "g2", "Robert Half <noreply@roberthalf.com>", "New role that matches your profile", "A Robert Half recruiter reviewed your resume and thinks you may be a fit for a contract analyst internship with one of our clients. Reply to learn more about the team and compensation.", null, null, "recruiter_outreach"),
  g("agency", "g3", "Priya Shah <priya@searchlight-partners.com>", "Introducing you to Anthropic", "Hello Sam, Searchlight Partners is helping Anthropic hire interns for the research engineering team. I would love to introduce you to the hiring manager. When are you free this week?", "Anthropic", "Research Engineering Intern", "recruiter_outreach"),
  g("agency", "g4", "Kforce <careers@kforce.com>", "Your application to Kforce", "Thanks for registering with Kforce. A consultant will contact you about open assignments that fit your skills.", null, null, "status_update"),
  // Sender is the employer, clear domain
  g("employer-sender", "e1", "University Recruiting <recruiting@figma.com>", "Your Figma interview", "Hi Sam, your interview for the Product Design Intern role is confirmed for Wednesday, November 18 at 2:00 PM. You will meet the design team over video.", "Figma", "Product Design Intern", "interview_scheduled"),
  g("employer-sender", "e2", "Campus Team <campus@cloudflare.com>", "An update on your application", "We wanted to let you know that we have moved your application for the Systems Engineer Intern role to the next stage. Expect an email from a recruiter within a week.", "Cloudflare", "Systems Engineer Intern", "status_update"),
  g("employer-sender", "e3", "Maya Chen <maya.chen@notion.so>", "Quick question about your background", "Hi Sam, I came across your portfolio and wondered if you would be interested in our Software Engineer Intern opening at Notion. Happy to share more.", "Notion", "Software Engineer Intern", "recruiter_outreach"),
  g("employer-sender", "e4", "Talent <talent@airbnb.com>", "Congratulations", "We are delighted to offer you the Data Analyst Intern position at Airbnb for Summer 2027. Please review the attached offer and respond by November 25.", "Airbnb", "Data Analyst Intern", "offer"),
  g("employer-sender", "e5", "Careers <careers@lyft.com>", "Thank you for applying", "Thank you for applying to the Product Management Intern role. Our team is reviewing your application and will reach out if there is a fit.", "Lyft", "Product Management Intern", "applied"),
  // Recruiter on a personal or generic address
  g("personal-sender", "p1", "Jordan Lee <jordanlee.recruits@gmail.com>", "Software internship at Coinbase", "Hi Sam, I recruit for Coinbase and saw your resume. We have a Software Engineer Intern role open for summer. Would you be open to a call on Tuesday?", "Coinbase", "Software Engineer Intern", "recruiter_outreach"),
  g("personal-sender", "p2", "Alex Kim <alex@mail-hiring.net>", "Following up", "Hi Sam, following up on my note about the internship. Let me know if you are still interested and when you could talk.", null, null, "recruiter_outreach"),
  g("personal-sender", "p3", "Sam Ortiz <sortiz@outlook.com>", "Role at Robinhood", "Hello Sam, I lead campus hiring at Robinhood. We would like to talk with you about the Software Engineer Intern position. Please send your availability.", "Robinhood", "Software Engineer Intern", "recruiter_outreach"),
  // Generic or look-alike domains
  g("generic-domain", "d1", "Hiring <hello@example-mail.com>", "Your application", "Thank you for your interest in Mapbox. We received your application for the Data Visualization Intern role and will be in touch.", "Mapbox", "Data Visualization Intern", "applied"),
  g("generic-domain", "d2", "Careers <noreply@jobs-notify.io>", "Application received", "Your application has been received. Our team will review it and contact you if your profile matches the role.", null, null, "applied"),
  g("generic-domain", "d3", "Hiring Team <team@careers-mail.co>", "We have an update", "We have reviewed your application for the Security Engineer Intern role at Okta and would like to move you forward to a technical phone screen next week.", "Okta", "Security Engineer Intern", "interview_invite"),
  // Unfamiliar phrasing, no hiring vocabulary
  g("unfamiliar", "u1", "Priya Nair <priya@datadoghq.com>", "Saturday", "Hi Sam, I could not reach you by phone. Could you let me know a good time to talk about joining our team this summer? Thursday afternoon works well for me.", "Datadog", null, "recruiter_outreach"),
  g("unfamiliar", "u2", GH, "Re: your references", "Hi Sam, we would like to speak with the two references you listed for your Plaid application. Please share their contact details by Monday.", "Plaid", null, "status_update"),
  g("unfamiliar", "u3", "People Team <people@vercel.com>", "Welcome aboard", "Hi Sam, we are thrilled that you accepted our offer! Your start date is June 8. Your onboarding buddy will write to you shortly.", "Vercel", null, "offer"),
  g("unfamiliar", "u4", LV, "A note from the team", "Hi Sam, we are keeping your resume on file for Cockroach Labs. There is no opening that fits right now, but we will reach out as soon as one appears.", "Cockroach Labs", null, "rejection"),
  // Not recruiting: look-alikes that name companies
  non("not-recruiting", "n1", "HackerRank <news@hackerrank.com>", "10 coding challenges to practice this week", "Sharpen your skills with our weekly challenges. Companies like Stripe and Datadog use similar problems in their interviews."),
  non("not-recruiting", "n2", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "Software Engineer Intern at Lyft and 9 more", "New jobs for you: Software Engineer Intern at Lyft, Data Analyst at Airbnb, and more. See all jobs."),
  non("not-recruiting", "n3", "Coursera <no-reply@coursera.org>", "Finish your Data Structures course", "You are 70% done with the course. Learners at companies like Google and Meta take this course to prepare for technical interviews."),
  non("not-recruiting", "n4", "Chase <alerts@chase.com>", "Your statement is ready", "Your November statement is available. Sign in to view your balance and recent activity."),
  non("not-recruiting", "n5", "Stanford Alumni <events@alumni.stanford.edu>", "Career panel with engineers from Figma and Notion", "Join us Thursday for a career panel. Engineers from Figma and Notion will share how they started their careers. RSVP below."),
  non("not-recruiting", "n6", "Mom <mom@gmail.com>", "Dinner Sunday?", "Are you coming home Sunday? Your cousin got a job at Google and we want to celebrate."),
  non("not-recruiting", "n7", "Greenhouse <no-reply@greenhouse.io>", "Your Greenhouse account", "Your password for the Greenhouse candidate portal was changed. If this was not you, contact support."),
  non("not-recruiting", "n8", "Handshake <no-reply@joinhandshake.com>", "Employers viewed your profile", "Three employers viewed your profile this week. Update your profile to get noticed."),
  // Status mail with unfamiliar wording
  g("status", "s1", GH, "Your Ashby application", "Hi Sam, we wanted to share that after careful consideration the team at Scale AI chose to pursue other candidates for the Machine Learning Intern position.", "Scale AI", "Machine Learning Intern", "rejection"),
  g("status", "s2", "Recruiting <recruiting@mongodb.com>", "Following up", "Hi Sam, we are still reviewing applications for the Software Engineer Intern role and appreciate your patience. We expect to have an update by the end of the month.", "MongoDB", "Software Engineer Intern", "status_update"),
  g("status", "s3", LV, "Interview availability", "Hi Sam, thanks for your reply. Slack's team has proposed Monday at 10 AM or Tuesday at 3 PM for your final round. Which do you prefer?", "Slack", null, "interview_invite"),
];

export const caseToEmail = (c: EntityCase): RecruitingEmail => ({ id: c.id, threadId: c.id, from: c.from, subject: c.subject, bodyText: c.body, receivedAt: new Date("2026-11-10T15:00:00Z"), outbound: false });
