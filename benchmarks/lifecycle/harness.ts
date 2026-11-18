import { buildActions } from "../../lib/recruiting/actions.ts";
import { buildOpportunities } from "../../lib/recruiting/opportunity.ts";
import { attentionCount, buildReviewQueue } from "../../lib/recruiting/review.ts";
import type { ActionKind, EffectiveEvent, EventType, Opportunity, Stage } from "../../lib/recruiting/types.ts";

/**
 * Lifecycle integrity benchmark harness (test-only). It feeds hand-built STORED events (the metadata the product persists: no message text) through the
 * product's real grouping, state, action and review code, and observes the result. Cases never reach into production internals: they use the public
 * builders (`buildOpportunities`, `buildActions`, `buildReviewQueue`), so the same cases keep working when the implementation behind them is rewritten.
 */
export type EvSpec = {
  id: string;
  /** ISO date or date-time the message was received. */
  at: string;
  type: EventType;
  company?: string | null;
  role?: string | null;
  /** Gmail thread. Defaults to a thread of its own. */
  thread?: string;
  /** Explicit date the message states (a deadline or a scheduled time). */
  date?: string;
  dateKind?: "deadline" | "scheduled";
  outbound?: boolean;
  signals?: string[];
  /** Field confidences; default {type .9, company .9, role .6}. */
  fc?: { type?: number; company?: number; role?: number };
  reviewReasons?: string[];
  /** The person corrected or confirmed this event (their word must survive regrouping). */
  corrected?: boolean;
  confirmed?: boolean;
  sender?: string;
};

export function ev(s: EvSpec, defaultCompany: string): EffectiveEvent {
  const fc = { type: 0.9, company: 0.9, role: 0.6, ...(s.fc ?? {}) };
  return {
    id: s.id,
    gmailMessageId: s.id,
    gmailThreadId: s.thread ?? `thread-${s.id}`,
    occurredAt: new Date(s.at.length === 10 ? `${s.at}T15:00:00Z` : s.at),
    outbound: s.outbound ?? s.type === "user_reply",
    senderName: s.outbound || s.type === "user_reply" ? "You" : "Recruiting",
    senderDomain: s.outbound || s.type === "user_reply" ? "" : (s.sender ?? "employer.example"),
    subject: `${s.type}`,
    type: s.type,
    company: s.company === undefined ? defaultCompany : s.company,
    role: s.role ?? null,
    eventDate: s.date ? new Date(s.date.length === 10 ? `${s.date}T00:00:00Z` : s.date) : null,
    eventDateHasTime: Boolean(s.date && s.date.length > 10),
    dateKind: s.date ? (s.dateKind ?? (s.type === "interview_scheduled" ? "scheduled" : "deadline")) : null,
    confidence: fc.type,
    fieldConfidence: { type: fc.type, company: fc.company, role: fc.role },
    reviewReasons: s.reviewReasons ?? [],
    signals: s.signals ?? [],
    corrected: s.corrected ?? false,
    ...(s.confirmed ? { confirmed: true } : {}),
  };
}

export type Observed = {
  /** The product's opportunities, each as the set of event ids it contains. */
  groups: Array<{ ids: string[]; company: string; role: string | null; stage: Stage; status: string; outcome: string | null; opportunity: Opportunity }>;
  groupOf: (eventId: string) => number;
  actions: Array<{ kind: ActionKind; opportunityKey: string; company: string; bucket: string; ids: string[]; title: string }>;
  reviewImportant: number;
  /** An opportunity counts as "in the active pipeline" when the product calls it active. A future `expired`/`dormant`/`cancelled` status is not active. */
  active: (eventId: string) => boolean;
};

export function observe(specs: EvSpec[], company: string, now: string): Observed {
  const events = specs.map((s) => ev(s, company));
  const opportunities = buildOpportunities(events);
  const nowDate = new Date(`${now}T12:00:00Z`);
  const floating = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), 12, 0));
  const groups = opportunities.map((o) => ({ ids: o.events.map((e) => e.id), company: o.company, role: o.role, stage: o.stage, status: o.status, outcome: o.outcome, opportunity: o }));
  const idsOfKey = new Map(opportunities.map((o) => [o.key, o.events.map((e) => e.id)]));
  const actions = buildActions(opportunities, floating).map((a) => ({ kind: a.kind, opportunityKey: a.opportunityKey, company: a.company, bucket: a.bucket, ids: idsOfKey.get(a.opportunityKey) ?? [], title: a.title }));
  const queue = buildReviewQueue(opportunities, undefined, [], nowDate);
  const groupIndex = new Map<string, number>();
  groups.forEach((g, i) => g.ids.forEach((id) => groupIndex.set(id, i)));
  return {
    groups,
    groupOf: (id) => groupIndex.get(id) ?? -1,
    actions,
    reviewImportant: attentionCount(queue),
    active: (id) => groups[groupIndex.get(id) ?? -1]?.status === "active",
  };
}

/** Pairwise grouping quality over a set of event ids: pairs together in truth versus pairs together in the product. */
export function pairwise(truth: string[][], predicted: string[][]) {
  const pairs = (groups: string[][]) => { const s = new Set<string>(); for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) s.add([g[i], g[j]].sort().join("|")); return s; };
  const t = pairs(truth), p = pairs(predicted);
  const tp = [...p].filter((x) => t.has(x)).length;
  return { truePairs: t.size, predictedPairs: p.size, correct: tp, wrongMerges: p.size - tp, missedLinks: t.size - tp, precision: p.size ? tp / p.size : 1, recall: t.size ? tp / t.size : 1 };
}
