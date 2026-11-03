/**
 * Label-quality audit. Works on labels alone: it never sees a prediction, an extractor output or an evaluation result,
 * so looking at it cannot anchor a later correction. Pure functions over (message, field, value, time) rows.
 */
export type RawLabel = { gmailMessageId: string; field: string; value: unknown; createdAt: Date | string };
export type LabelMap = Map<string, Record<string, unknown>>;

/** Newest row per (message, field) wins, matching how the evaluator resolves history. */
export function latestLabels(rows: RawLabel[]): LabelMap {
  const best = new Map<string, { at: number; seq: number; value: unknown }>();
  rows.forEach((r, seq) => {
    const key = `${r.gmailMessageId}\u0000${r.field}`;
    const at = new Date(r.createdAt).getTime();
    const cur = best.get(key);
    if (!cur || at > cur.at || (at === cur.at && seq > cur.seq)) best.set(key, { at, seq, value: r.value });
  });
  const out: LabelMap = new Map();
  for (const [key, { value }] of best) {
    const [id, field] = key.split("\u0000");
    const m = out.get(id) ?? {};
    m[field] = value;
    out.set(id, m);
  }
  return out;
}

const s = (v: unknown) => (v === undefined ? "(missing)" : String(v));
const dist = (values: unknown[]) => {
  const c = new Map<string, number>();
  for (const v of values) c.set(s(v), (c.get(s(v)) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/** The stage a type normally leaves the opportunity in. Types absent here (status_update, follow_up, user_reply) may sit in any stage. */
const STAGE_OF_TYPE: Record<string, string> = {
  applied: "applied", recruiter_outreach: "recruiter", assessment: "assessment", assessment_completed: "assessment",
  interview_invite: "interview", interview_scheduled: "interview", offer: "offer", rejection: "closed", withdrawn: "closed",
};
const RECRUITING_FIELDS = ["type", "company", "role", "opportunity_ref", "stage", "event_date", "actionable", "urgency"];

export type Flag = { id: string; reasons: string[] };

/** Why a label deserves a second look. "unknown" is the labeler's own doubt; the rest are internal contradictions. */
export function flagLabels(labels: LabelMap): Flag[] {
  const refCompanies = new Map<string, Set<string>>();
  for (const l of labels.values()) {
    if (l.is_recruiting === true && typeof l.opportunity_ref === "string" && typeof l.company === "string" && l.company !== "unknown") {
      const set = refCompanies.get(l.opportunity_ref) ?? new Set<string>();
      set.add(l.company.toLowerCase());
      refCompanies.set(l.opportunity_ref, set);
    }
  }
  const flags: Flag[] = [];
  for (const [id, l] of labels) {
    const reasons: string[] = [];
    if (l.is_recruiting === undefined) reasons.push("no recruiting decision");
    if (l.is_recruiting === true) {
      for (const f of RECRUITING_FIELDS) {
        if (l[f] === "unknown") reasons.push(`${f}: cannot tell`);
        else if (l[f] === undefined) reasons.push(`${f}: missing`);
      }
      for (const f of ["type", "company", "stage", "opportunity_ref", "actionable", "urgency"]) if (l[f] === "not_applicable") reasons.push(`${f}: not_applicable on a recruiting message`);
      const expected = STAGE_OF_TYPE[s(l.type)];
      if (expected && typeof l.stage === "string" && l.stage !== "unknown" && l.stage !== expected) reasons.push(`type ${s(l.type)} but stage ${s(l.stage)}`);
      if (l.type === "interview_scheduled" && (l.event_date === "not_applicable" || l.event_date === "unknown")) reasons.push("scheduled interview without a date");
      if (l.urgency === "today" && l.actionable === false) reasons.push("urgent but not actionable");
      if (typeof l.opportunity_ref === "string" && (refCompanies.get(l.opportunity_ref)?.size ?? 0) > 1) reasons.push("one opportunity id used for different companies");
    } else if (l.is_recruiting === false) {
      for (const f of RECRUITING_FIELDS) if (l[f] !== undefined && l[f] !== "not_applicable") reasons.push(`${f}: set on a non-recruiting message`);
    }
    if (reasons.length) flags.push({ id, reasons });
  }
  return flags.sort((a, b) => a.id.localeCompare(b.id));
}

export function summarize(labels: LabelMap, expectedMembers?: string[]) {
  const all = [...labels.entries()];
  const yes = all.filter(([, l]) => l.is_recruiting === true);
  const no = all.filter(([, l]) => l.is_recruiting === false);
  const col = (f: string) => yes.map(([, l]) => l[f]);
  const known = (f: string) => {
    let k = 0, u = 0, na = 0, miss = 0;
    for (const v of col(f)) { if (v === undefined) miss += 1; else if (v === "unknown") u += 1; else if (v === "not_applicable") na += 1; else k += 1; }
    return { known: k, unknown: u, notApplicable: na, missing: miss };
  };
  const opps = new Set(yes.map(([, l]) => l.opportunity_ref).filter((v): v is string => typeof v === "string" && v !== "unknown" && v !== "not_applicable"));
  const unknownLabels = all.reduce((n, [, l]) => n + Object.values(l).filter((v) => v === "unknown").length, 0);
  const withUnknown = all.filter(([, l]) => Object.values(l).some((v) => v === "unknown")).length;
  const flags = flagLabels(labels);
  return {
    totalLabeled: all.filter(([, l]) => l.is_recruiting !== undefined).length,
    expected: expectedMembers?.length ?? null,
    unlabeledMembers: expectedMembers ? expectedMembers.filter((id) => labels.get(id)?.is_recruiting === undefined).length : null,
    yes: yes.length, no: no.length,
    types: dist(col("type")), stages: dist(col("stage")),
    company: known("company"), role: known("role"), eventDate: known("event_date"),
    actionable: dist(col("actionable")), urgency: dist(col("urgency")),
    distinctOpportunities: opps.size,
    unknownLabelRows: unknownLabels, messagesWithUnknown: withUnknown,
    flaggedMessages: flags.length,
    flagReasons: dist(flags.flatMap((f) => f.reasons.map((r) => r.replace(/^.*?: /, (m) => m)))),
    flags,
  };
}
