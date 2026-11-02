import { buildActions, toFloating } from "./actions.ts";
import { extractAll } from "./extract.ts";
import { buildDemoMailbox } from "./fixtures.ts";
import { buildOpportunities } from "./opportunity.ts";

/** Runs the real pipeline over the synthetic mailbox — no DB, no Gmail. */
export function loadDemoWorkspace(now = new Date()) {
  const floating = toFloating(now);
  const events = extractAll(buildDemoMailbox(floating).map((f) => f.email)).map((e) => ({
    ...e,
    id: e.gmailMessageId,
    corrected: false,
  }));
  const opportunities = buildOpportunities(events);
  return { opportunities, actions: buildActions(opportunities, floating), now: floating };
}
