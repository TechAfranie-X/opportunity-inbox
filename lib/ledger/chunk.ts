import { decide, type Verdict } from "../decision/engine.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import { PRODUCT_READER_VERSION } from "../recruiting/product-version.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { buildLedger } from "./build.ts";
import type { MessageLedger } from "./types.ts";

export type LedgerEntry = { ledger: MessageLedger; verdict: Verdict };

/**
 * The ledgers and shadow verdicts for one sync chunk. Pure: it reads the rule reader's events from BEFORE any model stage touched them and the verified model readings, so the
 * ledger records what each reader said independently. A message neither reader said anything about gets no ledger. The product's own decisions are not an input and not an output.
 */
export function buildChunkLedgers(inbound: RecruitingEmail[], ruleEvents: ExtractedEvent[], opinions: Map<string, VerifiedOutput>): LedgerEntry[] {
  const ruleBy = new Map<string, ExtractedEvent>();
  for (const e of ruleEvents) if (!e.outbound && !ruleBy.has(e.gmailMessageId)) ruleBy.set(e.gmailMessageId, e);
  const out: LedgerEntry[] = [];
  for (const m of inbound) {
    const rule = ruleBy.get(m.id) ?? null, op = opinions.get(m.id);
    if (!rule && !op) continue;
    const ledger = buildLedger(m, rule, op, { readerVersion: PRODUCT_READER_VERSION, modelName: "local-model" });
    out.push({ ledger, verdict: decide(ledger) });
  }
  return out;
}
