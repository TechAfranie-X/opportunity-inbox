import type { EntityCase } from "../semantic/entity-set.ts";

/**
 * A second SYNTHETIC set, written for the identity milestone before the resolver was run on it. It targets relationships and naming, not phrasing:
 * team and function names around an employer, agencies acting for a client, brands that recruit through a parent, ordinary-word company names that
 * need more than one signal, companies no public list contains, and messages where a careful person cannot name the employer. `employer: null`
 * means unknown is the right answer. No real mail.
 */
const c = (group: string, id: string, from: string, subject: string, body: string, employer: string | null, role: string | null, type: string | null, recruiting = true): EntityCase => ({ id, group, from, subject, body, truth: { recruiting, employer, role, type } });
const GH = "Talent Team <no-reply@us.greenhouse-mail.io>";

export const HOLDOUT_CASES: EntityCase[] = [
  // team and function names around the employer, sent from the employer's own domain
  c("team-name", "t1", "Meta University Recruiting <university@meta.com>", "Your application to the Software Engineer Intern role", "Thank you for applying. Our university recruiting team received your application for the Software Engineer Intern role and will follow up soon.", "Meta", "Software Engineer Intern", "applied"),
  c("team-name", "t2", "Jane Street Campus Recruiting <campus@janestreet.com>", "Invitation to interview", "We enjoyed your application and would like to invite you to a first-round interview for the Quantitative Trading Intern role. Please share your availability for next week.", "Jane Street", "Quantitative Trading Intern", "interview_invite"),
  c("team-name", "t3", "Stripe Early Career <earlycareer@stripe.com>", "Your assessment", "Please complete your coding assessment for the Backend Engineer Intern role by Friday, November 20.", "Stripe", "Backend Engineer Intern", "assessment"),
  c("team-name", "t4", "Amazon Web Services Recruiting <aws-recruiting@amazon.com>", "Next steps for your application", "Thank you for your interest in the Cloud Support Engineer Intern role. We would like to schedule a phone screen.", "Amazon", "Cloud Support Engineer Intern", "interview_invite"),
  c("team-name", "t5", "Everpure Talent Team <talent@everpure.com>", "Thank you for applying", "We received your application for the Data Analyst Intern role and our team is reviewing it.", "Everpure", "Data Analyst Intern", "applied"),
  c("team-name", "t6", "Northfield Robotics People Team <people@northfieldrobotics.com>", "Offer details", "We are pleased to offer you the Mechanical Engineering Intern position. Please respond by November 30.", "Northfield Robotics", "Mechanical Engineering Intern", "offer"),
  // vendor-sent, team name carries the employer
  c("vendor-team", "v1", "Brightwave Recruiting via Greenhouse <no-reply@us.greenhouse-mail.io>", "Update on your application", "Hi Sam, thanks for applying for the Product Analyst Intern role. We would like to move you to the next step.", "Brightwave", "Product Analyst Intern", "status_update"),
  c("vendor-team", "v2", "Tessellate Careers <invites@codesignal.com>", "Tessellate: your coding assessment", "Tessellate has invited you to a 70 minute coding assessment. Please complete it within 5 days.", "Tessellate", null, "assessment"),
  c("vendor-team", "v3", "Candidate Care <jobs@smartrecruiters.com>", "Application received", "Your application for the Operations Analyst Intern position at Fernhill has been received.", "Fernhill", "Operations Analyst Intern", "applied"),
  c("vendor-team", "v4", "HackerRank <invites@hackerrank.com>", "Your invitation to complete a test", "You have been invited to complete a test. It should take about 60 minutes. Start it before November 22.", null, null, "assessment"),
  // agencies and intermediaries acting for a client
  c("agency", "g1", "Dana Reyes at Robert Half <dreyes@roberthalf.com>", "Robert Half recruiting for Stripe", "I am a recruiter with Robert Half. I am recruiting for Stripe on a Data Analyst Intern role and would like to speak with you.", "Stripe", "Data Analyst Intern", "recruiter_outreach"),
  c("agency", "g2", "Randstad Sourceright <noreply@randstad.com>", "Opportunity with Google", "Randstad is hiring on behalf of Google for an Operations Intern role. If you are interested, please reply with your availability.", "Google", "Operations Intern", "recruiter_outreach"),
  c("agency", "g3", "Kelly Services <recruiting@kellyservices.com>", "A role that fits your profile", "A recruiter at Kelly Services has reviewed your resume and would like to discuss a data entry internship with a client. Please reply for details.", null, null, "recruiter_outreach"),
  c("agency", "g4", "Harbor Staffing Solutions <hello@harborstaffing.com>", "Internship with a growing startup", "We are a staffing firm placing interns with technology startups. We are working with Plaid and would like to present your profile for their Software Engineer Intern opening.", "Plaid", "Software Engineer Intern", "recruiter_outreach"),
  // ordinary-word names need more than one signal
  c("ambiguous", "m1", "Scale AI Recruiting <recruiting@scale.com>", "Interview confirmation", "Your interview for the Machine Learning Intern position at Scale AI is confirmed for Tuesday, November 17 at 11:00 AM.", "Scale AI", "Machine Learning Intern", "interview_scheduled"),
  c("ambiguous", "m2", "Hiring <hello@toasttab.com>", "Thank you for applying", "Thank you for applying to Toast for the Software Engineer Intern role. We will be in touch.", "Toast", "Software Engineer Intern", "applied"),
  c("ambiguous", "m3", "Careers <noreply@x.com>", "Your application", "Thank you for applying to the Platform Engineer Intern role. We will review your application.", "X", "Platform Engineer Intern", "applied"),
  c("ambiguous", "m4", "Recruiting <jobs@ramp.com>", "We would like to schedule a call", "Hi Sam, a member of the Ramp recruiting team would like to schedule a short call about the Software Engineer Intern role.", "Ramp", "Software Engineer Intern", "recruiter_outreach"),
  c("ambiguous", "m5", "Notifications <no-reply@mail-notify.net>", "Your application was received", "Thank you for applying to Scale. We have received your application for the Business Operations Intern role.", null, "Business Operations Intern", "applied"),
  // companies no public list contains, ordinary employer domains
  c("unlisted", "u1", "Recruiting <recruiting@quillhaven.io>", "Interview next week", "Hi Sam, Quillhaven would like to invite you to interview for the Software Engineer Intern role. Please pick a time on Wednesday or Thursday.", "Quillhaven", "Software Engineer Intern", "interview_invite"),
  c("unlisted", "u2", "Talent <talent@emberlane.com>", "Thanks for your interest", "Thank you for your interest in Emberlane. We received your application for the Design Intern role.", "Emberlane", "Design Intern", "applied"),
  c("unlisted", "u3", "Lena Voss <lena@oakridgebio.com>", "Hello from Oakridge", "Hi Sam, I lead recruiting at Oakridge Bio. I saw your profile and wanted to talk about our Research Associate Intern role.", "Oakridge Bio", "Research Associate Intern", "recruiter_outreach"),
  c("unlisted", "u4", "Hiring <hiring@jobs-notify.io>", "We received your application", "We received your application for the Analyst Intern role. Our team will be in touch.", null, "Analyst Intern", "applied"),
  // employer only established by relationship in the message, vendor sender
  c("relationship", "r1", GH, "Your Brightwave interview", "Hi Sam, your interview with the Brightwave data team is confirmed for Monday, November 23 at 3:00 PM.", "Brightwave", null, "interview_scheduled"),
  c("relationship", "r2", GH, "Regarding your application", "Thank you for applying for the Research Intern position with the team at Neuralink. We have decided to move forward with other candidates.", "Neuralink", "Research Intern", "rejection"),
  c("relationship", "r3", "Interview Team <scheduling@goodtime.io>", "Pick a time for your interview", "Select a time for your interview with Anduril. Available slots are listed below.", "Anduril", null, "interview_invite"),
  c("relationship", "r4", "Candidate Updates <notifications@myworkday.com>", "Application status", "Your application to Datadog for the Software Engineer Intern role is now under review.", "Datadog", "Software Engineer Intern", "status_update"),
  // genuinely undeterminable
  c("undeterminable", "x1", GH, "Next steps", "Hi Sam, thanks for your time. We would like to schedule a final round conversation. Please send your availability.", null, null, "interview_invite"),
  c("undeterminable", "x2", "Recruiter <recruiter@gmail.com>", "Checking in", "Hi Sam, are you still interested in the internship we discussed? Please let me know this week.", null, null, "recruiter_outreach"),
  // not recruiting
  c("not-recruiting", "n1", "Stripe <notifications@stripe.com>", "Your Stripe receipt", "Thanks for your payment. Your receipt for November is attached.", null, null, null, false),
  c("not-recruiting", "n2", "Meta <security@facebookmail.com>", "Your security code", "Your code is 482913. Do not share it.", null, null, null, false),
  c("not-recruiting", "n3", "Google Careers Newsletter <news@careers.google.com>", "Tips for your next interview", "Read our guide on preparing for technical interviews. Unsubscribe at any time.", null, null, null, false),
  c("not-recruiting", "n4", "Toast <hello@toasttab.com>", "Your weekly sales summary", "Here is how your restaurant performed this week.", null, null, null, false),
];
