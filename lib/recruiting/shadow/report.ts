import type { ShadowRecord } from "./shadow.ts";

/**
 * Old-vs-v2 comparison for shadow mode. Aggregates only: counts and rates, never a message, a sender or a model output.
 * It is the instrument for the shadow period; it says how the two pipelines differ, not which one is right (that needs
 * labels from the prospective protocol).
 */
export type ReportRow = Pick<
  ShadowRecord,
  "gmailMessageId" | "cohort" | "uniformArm" | "isCandidate" | "legacyQueryMatch" | "plannedRead" | "planReason" | "state" | "reviewReason" | "rulesRecruiting" | "modelRecruiting" | "modelStatus" | "typeReview" | "companyReview" | "roleReview"
>;

const inc = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/**
 * The CURRENT product is rules-only: it fetches what its keyword query matches and calls a message recruiting when the
 * rules do. So its behavior is fully described by two stored facts, `legacyQueryMatch` and `rulesRecruiting`, and the
 * comparison needs neither the old sync nor anything shown to a user. Rows with an unrecorded legacy flag are excluded.
 */
export function summarize(rows: ReportRow[]) {
  const s = {
    total: rows.length,
    cohort: {} as Record<string, number>,
    candidates: 0,
    nonCandidateSample: 0,
    uniformArm: 0,
    plannedReads: 0,
    vetoed: {} as Record<string, number>,
    modelRead: 0,
    pendingModel: 0,
    states: {} as Record<string, number>,
    reviewReasons: {} as Record<string, number>,
    readers: { bothRead: 0, agree: 0, disagree: 0, modelAbstained: 0, rulesYesModelNo: 0, rulesNoModelYes: 0 },
    fieldFlagsAmongRecruiting: { type: 0, company: 0, role: 0 },
    vsOld: {
      oldFetched: 0,
      oldNotFetched: 0,
      bothRecruiting: 0,
      bothNotRecruiting: 0,
      v2OnlyRecruiting: 0,
      oldOnlyRecruiting: 0,
      oldRecruitingNowReview: 0,
      v2ReviewOldNot: 0,
      oldRecruitingOutsideV2Candidates: 0,
      legacyUnknown: 0,
      awaitingModel: 0,
    },
  };
  for (const r of rows) {
    inc(s.cohort, r.cohort);
    if (r.isCandidate) s.candidates += 1; else s.nonCandidateSample += 1;
    if (r.uniformArm) s.uniformArm += 1;
    if (r.plannedRead) {
      s.plannedReads += 1;
      if (r.modelStatus) s.modelRead += 1; else s.pendingModel += 1;
    } else if (r.isCandidate) inc(s.vetoed, r.planReason);
    inc(s.states, r.state);
    if (r.reviewReason) inc(s.reviewReasons, r.reviewReason);
    if (r.modelStatus) {
      s.readers.bothRead += 1;
      if (r.reviewReason === "model_abstained") s.readers.modelAbstained += 1;
      else if (r.rulesRecruiting === r.modelRecruiting) s.readers.agree += 1;
      else { s.readers.disagree += 1; if (r.rulesRecruiting) s.readers.rulesYesModelNo += 1; else s.readers.rulesNoModelYes += 1; }
    }
    if (r.state === "recruiting") {
      if (r.typeReview) s.fieldFlagsAmongRecruiting.type += 1;
      if (r.companyReview) s.fieldFlagsAmongRecruiting.company += 1;
      if (r.roleReview) s.fieldFlagsAmongRecruiting.role += 1;
    }
    // Old behavior is known only where the legacy flag was recorded.
    if (r.legacyQueryMatch === null) { s.vsOld.legacyUnknown += 1; continue; }
    const oldRecruiting = r.legacyQueryMatch && r.rulesRecruiting;
    if (!r.isCandidate) { if (oldRecruiting) s.vsOld.oldRecruitingOutsideV2Candidates += 1; continue; } // v2 never read it
    if (!r.legacyQueryMatch) { s.vsOld.oldNotFetched += 1; if (r.state === "recruiting") s.vsOld.v2OnlyRecruiting += 1; continue; }
    s.vsOld.oldFetched += 1;
    if (r.reviewReason === "pending_model") { s.vsOld.awaitingModel += 1; continue; } // undecided: not comparable yet
    if (r.state === "review") { if (oldRecruiting) s.vsOld.oldRecruitingNowReview += 1; else s.vsOld.v2ReviewOldNot += 1; continue; }
    if (r.state === "recruiting" && oldRecruiting) s.vsOld.bothRecruiting += 1;
    else if (r.state === "not_recruiting" && !oldRecruiting) s.vsOld.bothNotRecruiting += 1;
    else if (r.state === "recruiting") s.vsOld.v2OnlyRecruiting += 1;
    else s.vsOld.oldOnlyRecruiting += 1;
  }
  return s;
}

export type Summary = ReturnType<typeof summarize>;

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a");
const list = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ") || "none";

export function formatSummary(s: Summary): string {
  const decided = (s.states["recruiting"] ?? 0) + (s.states["not_recruiting"] ?? 0);
  return [
    `shadow reads: ${s.total} rows (${list(s.cohort)}) · candidates ${s.candidates} · uniform-arm non-candidates ${s.nonCandidateSample} · uniform arm total ${s.uniformArm}`,
    `routing: model reads planned ${s.plannedReads} (${pct(s.plannedReads, s.candidates)} of candidates) · vetoed ${list(s.vetoed)}`,
    `model coverage: read ${s.modelRead} · pending ${s.pendingModel}`,
    `v2 states: ${list(s.states)} · decided ${pct(decided, s.total)} · review reasons ${list(s.reviewReasons)}`,
    `readers (where both read): agree ${s.readers.agree} · disagree ${s.readers.disagree} (rules-yes/model-no ${s.readers.rulesYesModelNo}, rules-no/model-yes ${s.readers.rulesNoModelYes}) · model abstained ${s.readers.modelAbstained}`,
    `field flags among v2 recruiting: type ${s.fieldFlagsAmongRecruiting.type} · company ${s.fieldFlagsAmongRecruiting.company} · role ${s.fieldFlagsAmongRecruiting.role}`,
    `vs old path (candidate rows): old fetched ${s.vsOld.oldFetched} (${s.vsOld.awaitingModel} awaiting a model read, not compared), not fetched ${s.vsOld.oldNotFetched} · both recruiting ${s.vsOld.bothRecruiting} · both not ${s.vsOld.bothNotRecruiting} · v2-only recruiting ${s.vsOld.v2OnlyRecruiting} · old-only recruiting ${s.vsOld.oldOnlyRecruiting} · old recruiting now in review ${s.vsOld.oldRecruitingNowReview} · v2 review where old said not ${s.vsOld.v2ReviewOldNot}`,
    `old recruiting messages outside v2 candidates: ${s.vsOld.oldRecruitingOutsideV2Candidates} · legacy flag not recorded for ${s.vsOld.legacyUnknown} rows (excluded from the comparison)`,
    "(counts only; no message content, senders or model output; this compares the pipelines, it does not say which is right)",
  ].join("\n");
}
