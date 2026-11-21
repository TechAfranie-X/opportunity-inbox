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
