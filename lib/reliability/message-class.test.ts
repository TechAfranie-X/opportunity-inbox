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
