/**
 * Builds the PRIVATE real-mail evaluation corpus (stored OUTSIDE the repository, ids and labels only, no message text) from judgments recorded while reading the owner's real messages.
 * Every label says who made it: verifier "claude-reading" means Claude read the real message (subject, sender and the facts of its text) and judged it; ownerConfirmed stays false until the owner
 * confirms it. The owner can overwrite any label (the file is plain JSONL).   node ... scripts/build-corpus.ts <googleSub>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadWorkspace } from "../lib/recruiting/store.ts";
process.env.ENTRY_POLICY = "off"; // label every stored event, whatever the current view shows
const sub = process.argv[2];
const ws = await loadWorkspace(sub, new Date());
// Judgments by company, from reading the messages (see docs/personal-mvp.md). Anything not listed is labelled by its class default below.
const MODEL_ONLY_REAL = new Set(["Claude", "Salesforce", "Albany", "TheBlackManCan"]);
const MODEL_ONLY_UNSURE = new Set(["Cisco", "Gauntlet", "Walmart USA", "Bank of America", "AIG", "KPMG UK", "PwC", "Synchrony", "Siemens Mobility Forage", "Handshake AI", "Everpure"]);
const RULE_NOT_APPLICATION = new Set(["Datadog", "KPMG UK", "Trafigura", "Tata Consultancy Services", "Unknown company"]);
const RULE_UNSURE = new Set(["Deloitte Digital’s Salesfo", "Project Destined", "Amazon Affordable Housing Bridge", "Code in Place", "Last Mile Education Fund"]);
const FALSE_REJECTION_COMPANIES = new Set(["Explore HRT"]); // a receipt typed as a rejection (NVIDIA's receipts were confirmed by the person; its other message is a genuine rejection)
const OFFER_REAL = new Set(["Salesforce", "Alcon", "Stanford", "SLAC National Accelerator Laboratory"]);
const OFFER_FALSE = new Set(["Albany", "NSF funded AI assisted Cloud Infrastructure", "Cloudflare", "Unknown company", "Google"]);
const rows: object[] = [];
for (const o of ws.opportunities) for (const e of o.events) {
  if (e.outbound || e.signals.includes("near-miss")) continue;
  const modelOnly = e.signals.includes("semantic:event");
  const base = { account: sub.slice(0, 6), messageId: e.gmailMessageId, company: o.company, storedType: e.type, modelOnly, verifier: "claude-reading", ownerConfirmed: false };
  const name = o.company.replace(/\s+/g, " ").trim();
  let application: boolean | "unsure";
  const continuesRealApplication = o.events.some((x) => !x.outbound && !x.signals.includes("semantic:event") && !x.signals.includes("near-miss"));
  if (modelOnly && continuesRealApplication) application = "unsure"; // a model-found follow-up inside an application the rule reader found is a continuation, not a new claim
  else if (modelOnly) application = MODEL_ONLY_REAL.has(name) ? true : MODEL_ONLY_UNSURE.has(name) ? "unsure" : false;
  else application = RULE_NOT_APPLICATION.has(name) && o.events.filter((x) => !x.outbound).length === 1 ? false : RULE_UNSURE.has(name) ? "unsure" : true;
  let typeOk: boolean | "unsure" | undefined;
  if (e.type === "rejection") typeOk = e.corrected || e.confirmed ? "unsure" : FALSE_REJECTION_COMPANIES.has(name) ? false : true; // a person's confirmation or correction is their decision
  if (e.type === "offer") typeOk = e.corrected || e.confirmed ? "unsure" : OFFER_REAL.has(name) ? true : OFFER_FALSE.has(name) ? false : "unsure";
  rows.push({ ...base, application, typeOk });
}
const dir = `${homedir()}/.opportunity-inbox-corpus`; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/corpus-${sub.slice(0, 6)}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const c = rows as { application: unknown; typeOk?: unknown }[];
console.log(`corpus rows ${rows.length}: application true ${c.filter((r) => r.application === true).length}, false ${c.filter((r) => r.application === false).length}, unsure ${c.filter((r) => r.application === "unsure").length}; type judged ${c.filter((r) => r.typeOk !== undefined).length}`);
process.exit(0);
