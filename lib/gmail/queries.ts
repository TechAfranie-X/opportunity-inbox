/**
 * Gmail search that over-fetches recruiting-looking mail. It only has to be a
 * cheap first filter — the extractor decides what is actually recruiting.
 * Scope stays gmail.readonly; nothing is modified in the mailbox.
 */
export const RECRUITING_QUERY = [
  "newer_than:365d",
  "-in:spam -in:trash -in:sent -in:drafts",
  "(",
  'subject:(application OR applying OR applied OR interview OR assessment OR "coding challenge" OR "online assessment" OR offer OR recruiter OR candidacy OR "next steps" OR "your candidacy" OR internship OR "phone screen" OR "take-home")',
  "OR from:(greenhouse.io OR greenhouse-mail.io OR lever.co OR myworkday.com OR ashbyhq.com OR icims.com OR smartrecruiters.com OR workable.com OR jobvite.com OR hackerrank.com OR codesignal.com OR codility.com OR hirevue.com OR karat.com)",
  ")",
].join(" ");
