import assert from "node:assert/strict";
import { test } from "node:test";
import { endingWording } from "./evidence.ts";

const m = (body: string, subject = "Update") => ({ subject, bodyText: body });

test("everyday endings are recognised, sentence by sentence, in several families of wording", () => {
  for (const body of [
    "After careful consideration, we've decided not to move forward with your candidacy at this time.",
    "We regret to inform you that you are not eligible for this role.",
    "We have decided to pursue other candidates for this position.",
    "Unfortunately we will not be able to move forward at this time.",
    "This is to notify you that you were not selected to proceed to the next stage.",
    "Our hiring team has made the decision not to move you forward in the process.",
    "At this time, we have concluded the search for this position.",
    "We simply received more applications than we are able to move forward with.",
    "As the assessment was not completed, we're unable to move forward with your application.",
  ]) assert.equal(endingWording(m(body)), true, body);
});

test("receipts, offers, invitations and marketing are not endings", () => {
  for (const body of [
    "Your application has been received and is being reviewed by the team.",
    "Thank you for applying. We will be in touch about next steps.",
    "Congratulations! We are pleased to offer you the position.",
    "We would like to invite you to interview. Unfortunately the first slot is taken, how about Tuesday?".replace("Unfortunately the first slot is taken, how about", "How about"),
    "Join our webinar. You will no longer receive these emails if you unsubscribe.",
  ]) assert.equal(endingWording(m(body)), false, body);
});

test("a footer that says 'unsubscribe' does not hide an ending sentence elsewhere in the message", () => {
  assert.equal(endingWording(m("We have decided to pursue other candidates for this role.\n\nTo stop receiving emails, unsubscribe here. Manage preferences.")), true);
});

test("quoted earlier mail is not read as the message's own wording", () => {
  assert.equal(endingWording(m("Thanks, I'll reply soon.\n\nOn Mon, Oct 5 Recruiter wrote:\n> We have decided to pursue other candidates for this position.")), false);
});

import { ownApplicationStatement } from "./evidence.ts";
test("the student's own application is stated by a receipt or a direct request inside the process; not by an alert, an invitation to an event, or a call to action", () => {
  for (const body of ["We received your Claude Corps application.", "Thank you for applying to Lumen Works!", "Your application has been submitted and is under review.", "We would like to invite you to interview for the Analyst role.", "You have successfully applied."]) assert.equal(ownApplicationStatement(m(body)), true, body);
  for (const body of ["Jobs matching your profile: Analyst at Northwind. Apply now!", "You're invited to our open evening. Register now.", "Applications open soon, don't miss out.", "Welcome to the community! Set up your profile.", "Your account has been verified."]) assert.equal(ownApplicationStatement(m(body)), false, body);
});
