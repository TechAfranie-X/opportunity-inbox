import assert from "node:assert/strict";
import { test } from "node:test";
import { messageClass } from "./message-class.ts";

const m = (subject: string, body = "") => ({ subject, bodyText: body });
test("events, surveys, platform notices and community messages are not applications", () => {
  assert.equal(messageClass(m("Datadog x ColorStack 2026 IRL Event – Waitlist Update", "You are on the waitlist for the event.")), "event");
  assert.equal(messageClass(m("Confirmation: Launch Your Career Series: Program Overview Session")), "event");
  assert.equal(messageClass(m("Reminder! Tech Stories: Shipped & Equipped starts on June 3")), "event");
  assert.equal(messageClass(m("Your Feedback Matters: Application Experience Survey")), "survey");
  assert.equal(messageClass(m("The following contact from Northwind has reached out to you")), "notice");
  assert.equal(messageClass(m("Thanks for checking in!", "You're officially connected with Futureforce. Keep an eye on your inbox.")), "community");
});
test("acceptance into a programme is its own class; acceptance with employment wording or an explicit offer is not", () => {
  assert.equal(messageClass(m("Congratulations! You're in!", "Welcome to the Lumen AI Program, a 12-month training programme for students.")), "program-acceptance");
  assert.equal(messageClass(m("Congratulations! Welcome to the Externship", "You are accepted into our externship program. Your stipend and start date follow.")), null);
  assert.equal(messageClass(m("Your offer", "We are pleased to offer you a position in our graduate program.")), null);
});
test("a message that states the reader's own application is never classed away", () => {
  assert.equal(messageClass(m("Application received", "We received your application. Join our webinar next week to learn more.")), null);
  assert.equal(messageClass(m("Thank you for applying to the Summit Program!", "Your application has been submitted.")), null);
});

test("an acceptance into a programme that also says \"community\" is a programme acceptance, not a community message", () => {
  assert.equal(messageClass(m("Congratulations! You're in!", "You've been accepted to the 2026-27 cohort of the AI Program. Welcome to our national community of Fellows.")), "program-acceptance");
});

import { endingWording } from "./evidence.ts";
test("a student's own apology is not an employer's ending; the employer's sentence still is", () => {
  assert.equal(endingWording({ subject: "Re: Internship", bodyText: "Unfortunately, I was ill and could not reply for some weeks." }), false);
  assert.equal(endingWording({ subject: "Update", bodyText: "Unfortunately, we will not be moving forward with your candidacy." }), true);
  assert.equal(endingWording({ subject: "Update", bodyText: "I wanted to share that our last intern positions have been filled, so we won’t be moving forward with your candidacy." }), true);
});

test("a recruiter's conversational 'How did your interview go?' inside a next-step message is not a survey", () => {
  assert.equal(messageClass(m("Next Steps", "Hi, How did your last interview go? I'm excited to share we would like to move forward in the process! I would like to set up a recruiter screen.")), null);
});

test("an employer's interview invitation or assessment request is never classed as an event", () => {
  assert.equal(messageClass(m("Invitation to Interview with Acme", "Thank you for your interest in Acme. We would like to invite you to our Externship Interviews. This virtual session is 45 minutes.")), null);
  assert.equal(messageClass(m("Next step", "Please complete the online assessment within 7 days. This virtual event series is optional.")), null);
});

import { ownEnding, withdrawalAcknowledged } from "./evidence.ts";
test("an employer's plain ending about the reader's own application is recognised, hypotheticals and quoted history are not", () => {
  assert.equal(ownEnding({ subject: "Thanks for your interest", bodyText: "We appreciate the time you took to apply for the position: Software Engineer Intern. We are no longer reviewing applicants for this particular position." }), true);
  assert.equal(ownEnding({ subject: "Information regarding your job application", bodyText: "Unfortunately, we have to inform you that this time we have decided to move on with other candidates." }), true);
  assert.equal(ownEnding({ subject: "Next steps", bodyText: "Your application is active. If we are not moving forward with your candidacy we will tell you." }), false);
  assert.equal(ownEnding({ subject: "Re: Update", bodyText: "Great, see you Monday.\n\nFrom: Recruiter <r@x.com>\nDate: Monday\nTo: you\nSubject: Update\n\nUnfortunately we will not be moving forward with your application." }), false, "history quoted from an earlier message is not this message");
  assert.equal(ownEnding({ subject: "Re: Program", bodyText: "Because of these circumstances, with deep regret I must let you know that I will be unable to participate." }), false, "the reader's own narration");
});
test("the employer acknowledging a candidate's withdrawal is its own fact", () => {
  assert.equal(withdrawalAcknowledged({ subject: "Re: Program", bodyText: "Thank you for the update. We completely understand why you are unable to join us for the internship this summer." }), true);
  assert.equal(withdrawalAcknowledged({ subject: "Offer", bodyText: "We are excited that you are able to join us." }), false);
});

test("security codes, preference emails, section reminders and travel logistics are classed; an offer that mentions a background check is not", () => {
  assert.equal(messageClass(m("Security code for your application to Acme")), "admin");
  assert.equal(messageClass(m("Confirm your communication preferences")), "admin");
  assert.equal(messageClass(m("Friendly reminder before our first section")), "event");
  assert.equal(messageClass(m("Your Egencia travel itinerary and reimbursement forms")), "logistics");
  assert.equal(messageClass(m("Offer of employment", "We are pleased to offer you the position. This offer is subject to a background check.")), null);
});

test("an ending sentence about other applicants, a process description, or an event capacity notice does not settle an application", () => {
  assert.equal(ownEnding({ subject: "8 days left to finish your application", bodyText: "Submit by August 21 and you're entered to win. WEB101 applicants are not eligible, as prework is waived for that course." }), false);
  assert.equal(withdrawalAcknowledged({ subject: "Re: Update on Harvey", bodyText: "Based on where things stand today we anticipate filling all intern roles by the end of this week. I understand this isn't the update you were hoping for." }), false);
  assert.equal(messageClass(m("Innovate with Deutsche Bank Update", "Thank you for your interest in joining us at Innovate with Deutsche Bank. Due to capacity restrictions we are not able to invite you to participate in this event.")), "event");
});

test("an invitation to withdraw 'if you need to' is not an acknowledged withdrawal; a completed one is", () => {
  assert.equal(withdrawalAcknowledged({ subject: "Update", bodyText: "If you need to withdraw your application at any point due to timing, please just let me know." }), false);
  assert.equal(withdrawalAcknowledged({ subject: "Update", bodyText: "We have received your withdrawal of your application. Your application has been withdrawn." }), true);
});

test("an ending sentence wrapped over two lines is still one sentence", () => {
  assert.equal(ownEnding({ subject: "Thank you for interviewing with Acme", bodyText: "After careful review we have decided to move\nforward with other candidates at this time.\n" }), true);
});

test("'we have made the decision to not move forward' ends an application; a bulk promotion is classed marketing", () => {
  assert.equal(ownEnding({ subject: "Thanks for your interest in Acme", bodyText: "Thank you for your application to Acme! After reviewing your skills and experience, we have made the decision to not move forward for your application for the Intern position at this time." }), true);
});

test("a condition is not an ending: 'if you are not selected' and 'you will not be able to proceed if…'", () => {
  assert.equal(endingWording({ subject: "Thank you for applying", bodyText: "We have received your application. If you are not selected for this position, keep an eye on our jobs page." }), false);
  assert.equal(ownEnding({ subject: "Next steps", bodyText: "Thank you for completing your application. You will not be able to proceed to the next phase if the questionnaire is not completed." }), false);
  assert.equal(ownEnding({ subject: "Update", bodyText: "Thank you for your application. Unfortunately, we are not able to move forward with your candidacy." }), true);
});

import { namedRole } from "./evidence.ts";
test("the position a message names in its own words is extracted; generic phrases are not", () => {
  assert.equal(namedRole({ subject: "Your application with Acme", bodyText: "Although your skills are impressive, other candidates have been selected to move forward for the Internship - Digital, North America position. If a suitable position matches you will be contacted." }), "Internship - Digital, North America");
  assert.equal(namedRole({ subject: "Update", bodyText: "Thank you for your application for Software Engineer Intern (Summer 2027). We will be in touch." }), "Software Engineer Intern (Summer 2027)");
  assert.equal(namedRole({ subject: "Update", bodyText: "We will move forward to the next round of the process for the team." }), null);
});

import { campaignFact } from "./evidence.ts";
test("a mass-mailing campaign built around 'apply' links is marketing; a real receipt from the same host and a program invitation are not", () => {
  const campaign = { subject: "CBRE Full-Time Opportunity Powered By Acme Programs", bodyText: "View this email in your browser (https://mailchi.mp/x/y) CLICK HERE TO APPLY (https://host.example/apply) Applications are open." };
  assert.equal(campaignFact(campaign), true);
  assert.equal(messageClass(campaign), "marketing");
  const receipt = { subject: "Thanks for Submitting Your Application", bodyText: "Hi A, Thank you for applying to the CBRE Internship Opportunities via Acme Programs. This note confirms your submission." };
  assert.equal(messageClass(receipt), null);
  const invite = { subject: "Congratulations you're invited to CRE Fundamentals Level 1!", bodyText: "We are thrilled to extend an invitation to join our Commercial Real Estate Fundamentals Certificate Program delivered via Zoom. Three weekend sessions." };
  assert.equal(messageClass(invite), "program-acceptance");
});

test("a receipt names the opportunity it receipts, even when the name contains 'Opportunities'", () => {
  assert.equal(namedRole({ subject: "Thanks for Submitting Your Application", bodyText: "Thank you for applying to the CBRE Internship Opportunities via Acme Programs. This note confirms your submission." }), "CBRE Internship Opportunities via Acme Programs");
  assert.equal(namedRole({ subject: "Update", bodyText: "We will send more opportunities soon. Apply to new opportunities in the portal." }), null);
});

test("markdown emphasis does not hide a named programme; an invitation to join a programme that mentions internships is still a programme acceptance", () => {
  assert.equal(namedRole({ subject: "Bridge Program: Thank you for Submitting", bodyText: "Thank you for applying to the *ICSC Foundation Retail Real Estate Bridge Program.* This email confirms that we received your application." }), "ICSC Foundation Retail Real Estate Bridge Program");
  assert.equal(namedRole({ subject: "Thanks", bodyText: "Thank you for applying to the Crescent Communities Investments & Development Internship Opportunities via Acme Programs. This note confirms your submission." }), "Crescent Communities Investments & Development Internship Opportunities via Acme Programs");
  assert.equal(messageClass({ subject: "Congratulations you're invited to CRE Fundamentals Level 1!", bodyText: "We are thrilled to extend an invitation to join our Commercial Real Estate Fundamentals Certificate Program delivered via Zoom. Graduates are considered for internship pathways." }), "program-acceptance");
});

import { employerNamed, programStage } from "./evidence.ts";
test("the employer a message names, and the programme stage it speaks from", () => {
  assert.equal(employerNamed({ subject: "An update", bodyText: "Thank you for your interest in The Coca-Cola Company. The position has been filled." }), "The Coca-Cola Company");
  assert.equal(employerNamed({ subject: "Update", bodyText: "Thanks for your application to Texas Instruments. We have decided to move forward with other candidates." }), "Texas Instruments");
  assert.equal(employerNamed({ subject: "Update", bodyText: "Thank you for your interest in this opportunity. The role is closed." }), null);
  assert.equal(employerNamed({ subject: "Update", bodyText: "Thank you for your interest in the Software Engineer Intern role." }), null);
  assert.equal(programStage({ subject: "Welcome to Code in Place 2026!", bodyText: "You have been formally invited after we reviewed 66,000 applications." }), "accepted");
  assert.equal(programStage({ subject: "Section Reminder!", bodyText: "Your first section starts tomorrow." }), "enrolled");
  assert.equal(programStage({ subject: "Workshop", bodyText: "Congratulations on completing the workshop. Your certificate of completion is attached." }), "completed");
  assert.equal(programStage({ subject: "You're invited", bodyText: "We are thrilled to extend an invitation to join our Certificate Program." }), "invited");
});

test("names are matched sentence by sentence: a subject and a greeting never fuse, and a role stops at its clause", () => {
  assert.equal(employerNamed({ subject: "Thank you for your interest in Meta", bodyText: "Hi Afrane Owusu,\nWe received it." }), "Meta");
  assert.equal(employerNamed({ subject: "Code for Good Hackathon", bodyText: "Thanks for joining Code for Good." }), null);
  assert.equal(namedRole({ subject: "Application received", bodyText: "Thank you for applying to Full Stack Software Engineer Intern - Summer 2027 and we will review it promptly." }), "Full Stack Software Engineer Intern - Summer 2027");
});

test("a conditional 'if you have been selected' in a receipt is not a programme acceptance; a wrapped long programme name is still named", () => {
  assert.equal(programStage({ subject: "Thanks for Submitting Your Application", bodyText: "This note confirms your submission and you will be contacted in the case you have been selected to move forward." }), null);
  assert.equal(namedRole({ subject: "Thanks", bodyText: "Thank you for applying to the Crescent Communities Investments & Development Internship Opportunities via Project Destined.\nThis note confirms your submission." }), "Crescent Communities Investments & Development Internship Opportunities via Project Destined");
});

test("an employer named after 'position with', 'application status with' is found", () => {
  assert.equal(employerNamed({ subject: "Application Status on with The Coca-Cola Company: Start Your Legacy HBCU Externship", bodyText: "Thank you for taking the time to apply for the Start Your Legacy HBCU Externship - Digital & Technology position with The Coca-Cola Company. We have filled this role." }), "The Coca-Cola Company");
});

test("finishing one level and being invited to the next is programme evidence, not a job message", () => {
  const m = { subject: "Congratulations, you're invited to CRE Fundamentals Level 2!", bodyText: "Congratulations on your successful completion of CRE Fundamentals Level I. We are thrilled to invite you to continue your journey with us in Level II: Valuation." };
  assert.equal(programStage(m), "completed");
  assert.equal(messageClass(m), "program-acceptance");
});

test("an employer inviting the reader to take its assessment is not a programme acceptance", () => {
  assert.equal(messageClass({ subject: "Action Needed: Acme is inviting you to take the Acme Pre-Screening Assessment", bodyText: "We are excited to invite you to take part in the next phase of our hiring process: an online assessment." }), null);
});

test("'Congratulations! You have been selected to move forward with the pre-screen assessment' is a job assessment, not a programme acceptance", () => {
  assert.equal(messageClass({ subject: "Action Needed: Acme is inviting you to take the Acme Pre-Screen", bodyText: "Congratulations! You have been selected by Acme to move forward with the Acme Pre-Screen (General Coding Assessment), administered by CodeSignal." }), null);
});

test("a stated consequence is not a withdrawal: 'failing to attend will result in the withdrawal of your application'", () => {
  assert.equal(withdrawalAcknowledged({ subject: "Thanks for filling out this form", bodyText: "Attendance is required. Failing to attend will result in the withdrawal of your application." }), false);
  assert.equal(withdrawalAcknowledged({ subject: "Re: Program", bodyText: "Thank you for the update. We completely understand why you are unable to join us this summer." }), true);
});

test("platform names are never the employer, and a registration outcome is not an application outcome", () => {
  assert.equal(employerNamed({ subject: "Thanks for your interest in ZipRecruiter!", bodyText: "We received your application." }), null);
  assert.equal(ownEnding({ subject: "Your FGIT Resume Hub Registration", bodyText: "Unfortunately we are unable to confirm your registration for the hub at this time." }), false);
  assert.equal(messageClass({ subject: "Action Required: Complete Identity Verification", bodyText: "Please complete your identity verification to continue." }), "admin");
});

test("an employer's reminder of the reader's own interview is not an event", () => {
  assert.equal(messageClass({ subject: "Reminder: You have an upcoming interview with Acme", bodyText: "This is a reminder that you have an upcoming interview with Acme tomorrow at 10:00 AM." }), null);
});
