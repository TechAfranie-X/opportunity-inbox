import type { RecruitingEmail } from "../recruiting/types.ts";

/**
 * Synthetic stress sets. Written fresh with fictional companies and people; nothing here comes from any mailbox or dataset. The point
 * is not a score: it is to see, for phrasing the reader was never built around, whether a wrong outcome is ever SILENT (a recruiting
 * message nobody is shown, or a non-recruiting one shown as fact).
 *
 * HONESTY NOTE. `STRESS` was used while developing the reliability layer: after seeing which of its cases failed, the near-miss
 * criteria were refined (hiring mailboxes, onboarding vocabulary, platform senders, course/event vocabulary). It is therefore a
 * DEVELOPMENT set and its clean result proves nothing about generalisation. `HOLDOUT` was written afterwards, run once, and its
 * result recorded without changing any rule; it is the only honest stress number, and it is reported with its failures.
 */
export type Truth = "recruiting" | "not";
export type Stress = { name: string; truth: Truth; email: RecruitingEmail };

const IMP = ["INBOX", "IMPORTANT", "CATEGORY_UPDATES"];
const UPD = ["INBOX", "CATEGORY_UPDATES"];
const PROMO = ["INBOX", "CATEGORY_PROMOTIONS"];
const PERSONAL = ["INBOX", "CATEGORY_PERSONAL"];
let n = 0;
const m = (name: string, truth: Truth, from: string, subject: string, body: string, labels: string[]): Stress => ({
  name,
  truth,
  email: { id: `stress-${++n}`, threadId: `stress-t-${n}`, from, subject, receivedAt: new Date("2026-11-09T15:00:00Z"), outbound: false, bodyText: body, labels },
});

export const STRESS: Stress[] = [
  // ---- recruiting, familiar structure
  m("interview confirmed with time", "recruiting", "Priya Nair <priya.nair@northwind.example>", "Your interview is confirmed", "Hi Sam, your interview for the Platform Engineer Intern position is confirmed for Tuesday, November 17 at 2:00 PM. You will meet two engineers.", IMP),
  m("assessment with deadline", "recruiting", "Northwind Hiring <no-reply@us.greenhouse-mail.io>", "Northwind: online assessment for Platform Engineer Intern", "Hi Sam, please complete the online assessment for the Platform Engineer Intern role by November 20 at 11:59 PM.", IMP),
  m("offer letter", "recruiting", "Marcus Webb <marcus.webb@orchid.example>", "Your offer from Orchid Labs", "Congratulations Sam! We are pleased to extend you an offer for the Data Analyst Intern position at Orchid Labs. Please respond by November 22.", IMP),
  m("clear rejection", "recruiting", "Orchid Recruiting <jobs@orchid.example>", "An update on your Orchid Labs application", "Hi Sam, unfortunately we will not be moving forward with your application for the Data Analyst Intern role at this time.", IMP),

  // ---- recruiting, unfamiliar phrasing (the interesting ones)
  m("interview invitation, casual", "recruiting", "Elena Rossi <elena@lumen-works.example>", "Would love to meet you", "Hi Sam, we'd love to meet you. Does Tuesday at 11am or Wednesday at 3pm work for a 45 minute video call with the team about the Backend Engineer Intern position?", IMP),
  m("offer, warm tone", "recruiting", "Tomas Novak <tomas@lumen-works.example>", "Welcome aboard!", "We're thrilled to have you join us, Sam. Attached is your offer letter for the Backend Engineer Intern role at Lumen Works. Let me know if you have questions.", IMP),
  m("rejection, soft, unfamiliar", "recruiting", "Dana Reyes <dana.reyes@brightpath.example>", "Following up on your application", "Hi Sam, thanks for your time on Thursday. After talking it over with the team, we are going to keep looking for someone with more production experience for the Backend Engineer Intern role. Best of luck with your search.", IMP),
  m("rejection, other applicants", "recruiting", "Brightpath Talent <talent@brightpath.example>", "Thank you for your interest", "We appreciate the time you invested in applying for the Marketing Intern position. We have chosen to continue with other applicants. We wish you success in your future endeavors.", IMP),
  m("assessment, no keywords", "recruiting", "Aisha Khan <aisha.khan@cedar-grid.example>", "Next step: a short exercise", "Hi Sam, as the next stage for the Software Engineer Intern role, please finish the attached coding exercise within five days and reply with your solution.", IMP),
  m("recruiter cold outreach", "recruiting", "Ben Carter <ben.carter@cedar-grid.example>", "Your background", "Hi Sam, I lead university recruiting at Cedar Grid. Your projects stood out and I'd like to talk about our Software Engineer Intern openings. Do you have 15 minutes this week?", IMP),
  m("post-interview thanks", "recruiting", "Mei Tanaka <mei.tanaka@harbor-io.example>", "Thank you", "Hi Sam, thank you for taking the time to speak with us today about the Product Manager Intern role. We will be in touch by the end of next week with next steps.", IMP),
  m("onboarding paperwork", "recruiting", "People Ops <people@harbor-io.example>", "Getting ready for your start date", "Hi Sam, welcome! Before your first day on June 2 please complete your I-9 verification and background check authorization in the portal.", IMP),
  m("reschedule", "recruiting", "Jordan Lee <jordan.lee@harbor-io.example>", "Need to move our call", "Hi Sam, something came up and I need to move our interview for the Product Manager Intern role to Thursday at 4pm. Does that still work for you?", IMP),
  m("recruiting, not marked important", "recruiting", "Priya Nair <priya.nair@northwind.example>", "Following up", "Hi Sam, following up on your application for the Platform Engineer Intern position. We would like to schedule a short call with the hiring manager.", UPD),
  m("recruiting, vendor, no company", "recruiting", "Careers Portal <noreply@myworkday.com>", "Action required: your candidate profile", "Hello Sam, your job application is incomplete. Please sign in to the candidate portal to submit your résumé.", UPD),

  // ---- not recruiting
  m("newsletter", "not", "The Weekly Dev <news@weekly-dev.example>", "This week: 10 tips for your next interview", "Read our top interview tips. View in browser. Unsubscribe or manage preferences.", PROMO),
  m("job alert digest", "not", "JobBoard <alerts@jobboard.example>", "12 new Software Engineer Intern jobs for you", "New jobs match your search. Apply now. Manage alerts or unsubscribe.", PROMO),
  m("course marketing", "not", "LearnHub <hello@learnhub.example>", "Next steps for your application to the data course", "Complete your enrollment today and get 20% off tuition. Unsubscribe.", PROMO),
  m("scholarship application", "not", "Foundation <awards@foundation.example>", "Your scholarship application has been received", "Thank you for applying for the Merit Scholarship. Recipients are notified in May.", UPD),
  m("student club", "not", "Robotics Club <exec@robotics-club.example>", "Apply to join the executive team", "Applications for the 2027 executive team are now open. Apply by December 1.", UPD),
  m("bank alert", "not", "Bank <alerts@bank.example>", "Your statement is ready", "Your November statement is available. Sign in to view it.", UPD),
  m("friend", "not", "Alex <alex@mail.example>", "dinner friday?", "are we still on for dinner on friday", PERSONAL),
  m("apartment application", "not", "Leasing <leasing@oakview.example>", "Your application for Unit 4B", "Thank you for your application. We received your rental application and will review it within two business days.", UPD),
  m("credit application", "not", "Card Services <cards@finance.example>", "Your application was approved", "Your credit card application has been approved. Your card will arrive in 7-10 days.", UPD),
  m("press interview article", "not", "Tech Review <editor@techreview.example>", "Interview: how a startup hires interns", "In this interview we talk to a founder about hiring and what she looks for in an intern. Read more. Unsubscribe.", PROMO),
  m("hackathon invite", "not", "DevPost <events@devpost.example>", "You're invited: the 2027 student hackathon", "Register now for our student hackathon. Winners receive prizes and a chance to meet recruiters.", PROMO),
  m("receipt", "not", "RideCo <receipts@rideco.example>", "Your trip receipt", "Thanks for riding. Total $18.40. Payment charged to your card.", UPD),
  m("conference registration", "not", "Summit <info@devsummit.example>", "You're registered: Dev Summit", "You are registered for Dev Summit. Your ticket and the schedule are attached. Career fair on day two.", UPD),
  m("professor email", "not", "Prof. Lin <lin@university.example>", "Office hours moved", "Hi Sam, my office hours this week move to Thursday at 3pm. See you then.", PERSONAL),
  m("shipping", "not", "ShopCo <orders@shopco.example>", "Your order has shipped", "Your order #4471 has shipped and will arrive Thursday. Tracking number inside.", PROMO),
];

n = 100;
/** Written after the layer was frozen for this milestone. Different phrasings and structures from STRESS. Never tuned against. */
export const HOLDOUT: Stress[] = [
  // ---- recruiting
  m("scheduling link, informal", "recruiting", "Casey Park <casey.park@quill-labs.example>", "grab a time", "Hey Sam! Grab any slot that works for you here: calendly.example/casey. It's a chat with the team about the Analytics Intern role at Quill.", IMP),
  m("verbal offer", "recruiting", "Robin Ames <robin.ames@quill-labs.example>", "Good news", "I'm delighted to share that the team voted yes. We'd like you to join us as a Research Intern this summer. Formal paperwork follows tomorrow.", IMP),
  m("rejection, formal-lite", "recruiting", "Quill Talent <talent@quill-labs.example>", "Your candidacy", "We reviewed your materials thoroughly and, while we were impressed, we will not proceed with your candidacy for the Design Intern opening.", IMP),
  m("skills test from platform", "recruiting", "SkillCheck <invites@hirevue.com>", "You've been invited", "You have been invited to take a skills test on behalf of Quill Labs. Use the link to begin; it expires in 7 days.", UPD),
  m("recruiter nudge", "recruiting", "Casey Park <casey.park@quill-labs.example>", "bumping this up", "Just bumping this to the top of your inbox. Are you still interested in the Finance Intern role? Happy to answer questions.", IMP),
  m("interview preparation", "recruiting", "Interview Team <interviews@quill-labs.example>", "What to expect on Friday", "Here is what to expect in your upcoming interviews: a panel of three engineers, a 45 minute system design conversation, and a short Q&A.", IMP),
  m("reference request", "recruiting", "Robin Ames <robin.ames@quill-labs.example>", "References", "We'd like to speak with two references for your application. Could you send their names and email addresses?", IMP),
  m("compensation call", "recruiting", "Casey Park <casey.park@quill-labs.example>", "Let's talk numbers", "Let's talk compensation for the Sales Development internship. Are you free for a quick call tomorrow?", IMP),
  m("intern housing", "recruiting", "People Team <people@quill-labs.example>", "Summer housing", "Congratulations again! Here is information about intern housing and relocation support for your summer start.", IMP),
  m("application received, unusual", "recruiting", "Quill Careers <no-reply@us.greenhouse-mail.io>", "We got it!", "Your submission for the Operations Intern job is in our system. Our team reviews every application.", UPD),
  m("virtual onsite agenda", "recruiting", "Coordinator <coordinator@quill-labs.example>", "Your virtual onsite agenda", "Hi Sam, attached is the schedule for your virtual onsite on Monday: four 45 minute sessions with the team.", IMP),
  m("portal notification, no content", "recruiting", "Quill via Greenhouse <no-reply@us.greenhouse-mail.io>", "A new message is waiting", "You have a new message from the Quill hiring team in your candidate inbox. Sign in to read it.", UPD),

  // ---- not recruiting
  m("campus job digest", "not", "Handshake <digest@joinhandshake.com>", "New jobs this week at companies you follow", "5 new internships match your interests. Unsubscribe or update preferences.", PROMO),
  m("career center workshop", "not", "Career Center <careers@university.example>", "Resume workshop Tuesday", "Join our resume workshop on Tuesday at 4pm. Light refreshments provided. RSVP below.", UPD),
  m("airline itinerary", "not", "AirCo <booking@airco.example>", "Your itinerary", "Your flight is confirmed. Departure Friday 6:15 AM. Check in online 24 hours before.", UPD),
  m("gym application", "not", "FitHub <hello@fithub.example>", "Your membership application", "Thanks for applying for a membership. A team member will confirm your plan within a day.", UPD),
  m("profile viewed", "not", "LinkedIn <notifications@linkedin.com>", "Someone viewed your profile", "A recruiter at a company viewed your profile this week. See who. Manage notification settings.", PROMO),
  m("internship tips blog", "not", "CareerBlog <editor@careerblog.example>", "How to land a summer internship", "Seven tips for landing an internship: tailor your resume, prepare for the interview, follow up. Subscribe for more.", PROMO),
  m("loan application update", "not", "Lender <updates@lender.example>", "An update on your application", "There is an update on your student loan application. Sign in to see the status of your application.", UPD),
  m("parent", "not", "Mom <mom@family.example>", "call me", "call me when you get a chance, nothing urgent", PERSONAL),
  m("class assignment", "not", "Prof. Ortiz <ortiz@university.example>", "Assignment: interview a professional", "For this week's assignment, interview a professional in your field about their career path and write a one page summary.", PERSONAL),
  m("payment app", "not", "PayFast <noreply@payfast.example>", "You received $25", "Jordan sent you $25. The money is in your balance.", UPD),
  m("visa application", "not", "Immigration <noreply@immigration.example>", "Update on your application", "The status of your visa application has changed. Sign in to view the decision on your application.", UPD),
  m("promo using the word offer", "not", "StyleCo <deals@styleco.example>", "Job offer: 50% off everything", "Our best offer of the season. Shop now. Unsubscribe.", PROMO),
];
