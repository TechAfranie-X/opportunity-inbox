/**
 * The evidence ledger: for each message, every reading anyone made of it, kept side by side.
 *
 * Why it exists. Until now each stage (rule reader, facts, model assist, refinement) rewrote the event and sometimes DELETED what an earlier stage said, so a guard added for one
 * message could silently throw away correct evidence for hundreds (the model-alone gate cost 20 points of status accuracy). A ledger only ever APPENDS claims. A decision is a
 * function of the claims and is recomputed whenever the logic changes, with no Gmail refetch and no model call.
 *
 * What it must never hold: message bodies, quotations, prompts or unrestricted model responses. That is enforced structurally: a claim value is one of an enumerated set, or a short
 * employer / role string that the product already stores on the event, and the model's evidence is a hash plus an offset (traceable without content). `parseLedger` rejects anything else.
 */
export const LEDGER_VERSION = 1;

/** rule: the deterministic reader. model: the local language model after verification. fact: a deterministic property of the text. person: the owner's own correction or confirmation. */
export const CLAIM_SOURCES = ["rule", "model", "fact", "person"] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export const CLAIM_KINDS = ["recruiting", "event_type", "employer", "role", "fact"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** Deterministic facts about a message. Each is a yes/no property of the text; none carries text. */
export const FACT_NAMES = [
  "closure_wording", // terminal wording about the reader's own application
  "marketing_alert", // a job-recommendation digest
  "marketing_bulk", // mass-mail markers with no personal anchor
  "not_own_process", // subject is a membership / welcome / promotion with nothing about the reader's own process
  "own_process_wording", // speaks about the reader's own application, interview, assessment, offer or candidacy
  "explicit_offer", // explicit offer wording
  "rule_doubt_membership", // the rule reader doubted membership of the process
  "rule_doubt_conflict", // the rule reader saw an outcome conflict
] as const;
export type FactName = (typeof FACT_NAMES)[number];

export const EVENT_TYPE_VALUES = ["applied", "recruiter_outreach", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "status_update", "offer", "rejection", "withdrawn", "follow_up", "user_reply"] as const;

export type Claim = {
  /** Unique within a message: source.producer.kind.value */
  id: string;
  source: ClaimSource;
  /** Which reader produced it: "rules", a model name, or the fact function. */
  producer: string;
  kind: ClaimKind;
  /** recruiting: "yes" | "no". event_type: an event type. fact: a FactName. employer / role: a short name the event already stores. */
  value: string;
  /** How strongly the producer asserts it, 0..1. */
  strength: number;
  /** Where the producer's evidence sits in the normalised message: a hash and an offset, never the text. */
  grounding: { hash: string; offset: number } | null;
};

export type MessageLedger = {
  version: typeof LEDGER_VERSION;
  messageId: string;
  threadId: string;
  receivedAt: string; // ISO
  outbound: boolean;
  senderDomain: string;
  /** The product reader version the claims were produced under. */
  readerVersion: string;
  claims: Claim[];
};

const MAX_FREE = 80;
const NAME_SHAPED = /^[^\n\r\t]{1,80}$/;

/** Throws when a ledger could carry content. Used on every write and every read from storage. */
export function parseLedger(raw: unknown): MessageLedger {
  const bad = (why: string): never => { throw new Error(`invalid ledger: ${why}`); };
  if (!raw || typeof raw !== "object") return bad("not an object");
  const l = raw as Record<string, unknown>;
  if (l.version !== LEDGER_VERSION) bad("version");
  for (const k of ["messageId", "threadId", "receivedAt", "senderDomain", "readerVersion"] as const) if (typeof l[k] !== "string" || (l[k] as string).length > 200) bad(k);
  if (typeof l.outbound !== "boolean") bad("outbound");
  if (!Array.isArray(l.claims) || l.claims.length > 64) bad("claims");
  const seen = new Set<string>();
  const claims = (l.claims as unknown[]).map((c): Claim => {
    if (!c || typeof c !== "object") return bad("claim");
    const x = c as Record<string, unknown>;
    if (!CLAIM_SOURCES.includes(x.source as ClaimSource)) bad("source");
    if (!CLAIM_KINDS.includes(x.kind as ClaimKind)) bad("kind");
    if (typeof x.producer !== "string" || !NAME_SHAPED.test(x.producer)) bad("producer");
    if (typeof x.strength !== "number" || !(x.strength >= 0 && x.strength <= 1)) bad("strength");
    if (typeof x.value !== "string") bad("value");
    const value = x.value as string;
    if (x.kind === "recruiting" && value !== "yes" && value !== "no") bad("recruiting value");
    if (x.kind === "event_type" && !(EVENT_TYPE_VALUES as readonly string[]).includes(value)) bad("event_type value");
    if (x.kind === "fact" && !(FACT_NAMES as readonly string[]).includes(value)) bad("fact value");
    if ((x.kind === "employer" || x.kind === "role") && (value.length > MAX_FREE || !NAME_SHAPED.test(value))) bad("free-text value too long or multi-line");
    const g = x.grounding;
    if (g !== null && g !== undefined) {
      const o = g as Record<string, unknown>;
      if (typeof o.hash !== "string" || !/^[0-9a-f]{8,64}$/.test(o.hash) || typeof o.offset !== "number" || !Number.isFinite(o.offset)) bad("grounding");
    }
    const id = `${x.source}.${x.producer}.${x.kind}.${value}`;
    if (x.id !== id) bad("claim id");
    if (seen.has(id)) bad("duplicate claim");
    seen.add(id);
    return { id, source: x.source as ClaimSource, producer: x.producer as string, kind: x.kind as ClaimKind, value, strength: x.strength as number, grounding: g ? { hash: (g as { hash: string }).hash, offset: (g as { offset: number }).offset } : null };
  });
  return { version: LEDGER_VERSION, messageId: l.messageId as string, threadId: l.threadId as string, receivedAt: l.receivedAt as string, outbound: l.outbound as boolean, senderDomain: l.senderDomain as string, readerVersion: l.readerVersion as string, claims };
}

export const claimId = (source: ClaimSource, producer: string, kind: ClaimKind, value: string) => `${source}.${producer}.${kind}.${value}`;
