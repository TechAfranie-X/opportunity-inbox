// Read-only probe: for given Gmail message ids, reports ONLY which named phrase families match the message (booleans and word counts). No text is printed or stored.
// Usage: probe-phrases.ts <googleSub> <id> [<id> ...]
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
const FAMILIES: Record<string, RegExp> = {
  closed: /\b(?:application|candidacy|requisition|job posting|position)\b[^.!?]{0,80}\b(?:has been|is|was|have been) (?:closed|filled|withdrawn|cancell?ed|declined)\b/i,
  closedAlt: /\bwe (?:have )?(?:closed|ended|concluded) (?:your|the) (?:application|candidacy|process)\b/i,
  noLonger: /\bno longer (?:be )?(?:under )?(?:consideration|being considered|active|available|moving forward)\b/i,
  notMoving: /\b(?:not|won'?t|will not|unable to|cannot|can'?t) (?:be )?(?:moving|proceed(?:ing)?|continu(?:e|ing)|advanc(?:e|ing)|go(?:ing)? forward|pursu(?:e|ing))\b/i,
  unfortunately: /\bunfortunately\b/i,
  decided: /\bwe have decided\b[^.!?]{0,60}\b(?:not|other|different|another)\b/i,
  notSelected: /\b(?:not|wasn'?t|were not) (?:been )?selected\b|\bnot chosen\b|\bnot a (?:fit|match)\b/i,
  wishSuccess: /\bwish you (?:the best|success|luck|well)\b/i,
  statusChanged: /\bstatus (?:of|for) your (?:application|candidacy) (?:has )?(?:changed|been updated)\b/i,
  workdayView: /\bview (?:your )?(?:application|status)\b/i,
};
const sub = process.argv[2];
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const { emails } = await fetchEmailsById(token, process.argv.slice(3));
for (const m of emails) console.log(m.id, m.receivedAt.toISOString().slice(0, 10), `words=${m.bodyText.split(/\s+/).length}`, Object.entries(FAMILIES).filter(([, re]) => re.test(`${m.subject}\n${m.bodyText}`)).map(([k]) => k).join(",") || "(none)");
process.exit(0);
