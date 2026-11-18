import { createHash } from "node:crypto";
import type { ReaderInput } from "../recruiting/reader/types.ts";
import { SEMANTIC_GUIDE, SEMANTIC_GUIDE_VERSION } from "./guide-v2.ts";
import type { SemanticReader } from "./port.ts";
import { verifyReading, type VerifiedReading } from "./reading.ts";

/**
 * A HOSTED semantic reader, built and tested but DISABLED. Nothing in the product constructs it, and it contains no network code: the model call
 * is an injected `transport`, so enabling it is one small function that needs an explicit decision (a paid model, and redacted message text leaving
 * the machine). `hostedApproval` is the second lock: even with a transport, the reader refuses to run unless the owner has set the approval
 * variable to the exact phrase below.
 *
 * What would leave the machine, per message, and nothing else: the display name and domain of the sender, the subject, up to 1,400 characters of
 * the body with links, addresses, long numbers and the account holder's name removed, the received time, and up to five employer names found by the
 * local resolver. Only messages that pass the local veto-only triage are sent. Responses are verified locally (lib/semantic/reading.ts); only the
 * verified structured result is cached, in memory, keyed by a hash of the redacted input. No raw body is stored by the product.
 */
export const APPROVAL_PHRASE = "I-approve-external-model-cost-and-redacted-text";
export const hostedApproval = (env: Record<string, string | undefined>) => env.SEMANTIC_HOSTED_APPROVED === APPROVAL_PHRASE;

export type Transport = (request: { system: string; user: string; model: string }) => Promise<string>;

/** The cheapest current model that can do the job is the default; the owner chooses. See docs/semantic-intelligence.md for the measured and estimated tradeoffs. */
export const DEFAULT_HOSTED_MODEL = "claude-haiku-5-5";
const BATCH = 8;

const inputHash = (i: ReaderInput) => createHash("sha256").update(JSON.stringify([SEMANTIC_GUIDE_VERSION, i.from, i.subject, i.body, i.candidates.map((c) => c.name)])).digest("hex");

export function createHostedReader(opts: { transport: Transport; env: Record<string, string | undefined>; model?: string; cache?: Map<string, VerifiedReading> }): SemanticReader {
  if (!hostedApproval(opts.env)) throw new Error("Hosted semantic reader is disabled: it needs the owner's explicit approval (SEMANTIC_HOSTED_APPROVED).");
  const cache = opts.cache ?? new Map<string, VerifiedReading>();
  const model = opts.model ?? DEFAULT_HOSTED_MODEL;
  const readings = async (inputs: ReaderInput[]) => {
    const out = new Map<string, VerifiedReading>();
    const todo: ReaderInput[] = [];
    for (const i of inputs) {
      const hit = cache.get(inputHash(i));
      if (hit) out.set(i.key, { ...hit, key: i.key, output: { ...hit.output, key: i.key } });
      else todo.push(i);
    }
    for (let at = 0; at < todo.length; at += BATCH) {
      const batch = todo.slice(at, at + BATCH);
      const user = JSON.stringify(batch.map((i) => ({ key: i.key, from: i.from, subject: i.subject, body: i.body, received: i.received, employer_candidates: i.candidates.map((c) => c.name) })));
      let parsed: unknown;
      try {
        const text = await opts.transport({ system: SEMANTIC_GUIDE, user, model });
        parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
      } catch {
        continue; // a failed or unreadable answer is no opinion
      }
      const byKey = new Map((Array.isArray(parsed) ? parsed : []).map((o: { key?: string }) => [o?.key, o] as const));
      for (const i of batch) {
        const v = verifyReading(byKey.get(i.key), i);
        if (v.output.status === "invalid") continue;
        cache.set(inputHash(i), v);
        out.set(i.key, v);
      }
    }
    return out;
  };
  return {
    id: `hosted:${model}`,
    readings,
    async opine(inputs) {
      return new Map([...(await readings(inputs))].map(([k, v]) => [k, v.output] as const));
    },
  };
}
