import type { VerifiedOutput } from "../reader/types.ts";
import type { AnalysisRow, Population } from "./analysis.ts";
import { computeAnalysis } from "./analysis.ts";
import { FROZEN } from "./frozen.ts";
import { toAnalysisRow } from "./join.ts";
import { selectLabelSet, type IngestionFacts, type Selected } from "./labelset.ts";
import { resolveRecord, uniformArm, type ShadowRecord } from "./shadow.ts";
import { mulberry32 } from "./stats.ts";

/**
 * Synthetic prospective data, to exercise the whole workflow (ingestion facts, label-set selection, labeling, analysis)
 * WITHOUT consuming real future evidence. Everything is in memory and obviously fake: ids start with "SYNTH-", mailboxes are
 * "synthetic-a" / "synthetic-b", and the real analysis command refuses rows like these.
 *
 * Two independent random streams: `factSeed` fixes what arrives, who is a candidate, the sampling arm and the ground truth;
 * `readerSeed` fixes what the readers said. Holding `factSeed` and varying `readerSeed` must never change which messages are
 * selected for labeling (tested): that is the leakage property.
 */
export const SYNTHETIC_PREFIX = "SYNTH-";
export const SYNTHETIC_MAILBOXES = ["synthetic-a", "synthetic-b"] as const;

export type Quality = "good" | "marginal" | "poor";
export type SyntheticParams = { factSeed: number; readerSeed: number; weeks: number; weeklyPerMailbox: number; prevalence: number; quality: Quality };

const Q: Record<Quality, { rulesRecall: number; rulesFP: number; modelRecall: number; modelFP: number; abstain: number; typeRight: number; ungrounded: number }> = {
  good: { rulesRecall: 0.96, rulesFP: 0.01, modelRecall: 0.97, modelFP: 0.004, abstain: 0.02, typeRight: 0.96, ungrounded: 0 },
  marginal: { rulesRecall: 0.88, rulesFP: 0.02, modelRecall: 0.9, modelFP: 0.01, abstain: 0.04, typeRight: 0.84, ungrounded: 0 },
  poor: { rulesRecall: 0.6, rulesFP: 0.04, modelRecall: 0.65, modelFP: 0.03, abstain: 0.08, typeRight: 0.6, ungrounded: 0.02 },
};

export type SyntheticTruth = { positive: boolean; type: string | null; company: string | null; role: string | null; opportunity: string | null };

export function generateSynthetic(p: SyntheticParams) {
  const facts = mulberry32(p.factSeed);
  const readers = mulberry32(p.readerSeed);
  const q = Q[p.quality];
  const cutoff = new Date(FROZEN.cutoff).getTime();
  const records: ShadowRecord[] = [];
  const truth = new Map<string, SyntheticTruth>();
  const population: Population = { candidateRows: 0, plannedReads: 0, vetoed: 0, legacyOnlyRows: 0, nonCandidateArmRows: 0 };
  const TYPES = ["applied", "assessment", "interview_invite", "status_update", "offer", "rejection"] as const;

  for (const mailbox of SYNTHETIC_MAILBOXES) {
    let opp = 0, oppLeft = 0, thread = 0, threadLeft = 0;
    for (let i = 0; i < p.weeks * p.weeklyPerMailbox; i += 1) {
      // ---- facts stream ----
      const id = `${SYNTHETIC_PREFIX}${mailbox}-${i}`;
      const arrivedAt = new Date(cutoff + Math.floor((i / (p.weeks * p.weeklyPerMailbox)) * p.weeks * 7 * 86400000) + Math.floor(facts() * 3600000));
      if (threadLeft === 0) { thread += 1; threadLeft = 1 + Math.floor(facts() * 3); }
      threadLeft -= 1;
      const positive = facts() < p.prevalence;
      if (positive && oppLeft === 0) { opp += 1; oppLeft = 1 + (facts() < 0.25 ? Math.floor(facts() * 5) : 0); } // a heavy tail of multi-message hiring processes
      if (positive) oppLeft -= 1;
      const type = positive ? TYPES[Math.floor(facts() * TYPES.length)] : null;
      const candidate = positive ? facts() < 0.99 : facts() < 0.6;
      const vetoed = candidate && !positive && facts() < 0.09;
      const legacyMatch = positive ? facts() < 0.65 : facts() < 0.1;
      const arm = uniformArm(mailbox, id, FROZEN.uniformRate);
      truth.set(id, { positive, type, company: positive ? `Employer ${opp}` : null, role: null, opportunity: positive ? `${mailbox}-opp-${opp}` : null });

      // ---- recording rule, as in the collector: candidates always; keyword-only mail always; other mail only if in the arm ----
      const recorded = candidate || legacyMatch || arm;
      // ---- reader stream (always drawn, so the stream never shifts with the facts) ----
      const rr = readers(), mr = readers(), ab = readers(), tr = readers(), ug = readers(), rt = readers();
      if (!recorded) continue;
      const plannedRead = candidate && !vetoed;
      const rulesYes = candidate || legacyMatch ? (positive ? rr < q.rulesRecall : rr < q.rulesFP) : false;
      const rec: ShadowRecord = {
        userGoogleSub: mailbox, gmailMessageId: id, gmailThreadId: `${mailbox}-t${thread}`, readerVersion: FROZEN.readerVersion,
        pipelineVersion: FROZEN.pipelineVersion, extractorVersion: FROZEN.extractorVersion, arrivedAt, senderDomain: "synthetic.example",
        cohort: "prospective", uniformArm: arm, isCandidate: candidate, legacyQueryMatch: legacyMatch, plannedRead,
        planReason: candidate ? (vetoed ? "noise:commerce" : "protected") : "not_candidate",
        rulesRecruiting: rulesYes, rulesType: rulesYes ? (positive && rt < q.typeRight - 0.1 ? type : "status_update") : null, rulesCompany: null, rulesRole: null,
        modelStatus: null, modelRecruiting: null, modelType: null, modelStage: null, modelCompany: null, modelRole: null, modelCertainty: null, modelEvidenceHash: null, modelRejections: null, modelUngrounded: null, modelReadAt: null,
        state: "not_recruiting", reviewReason: null, modelSuggests: null, typeReview: false, companyReview: false, roleReview: false, finalType: null, finalCompany: null, finalRole: null,
      } as ShadowRecord;
      let out = rec;
      if (plannedRead) {
        const modelYes = positive ? mr < q.modelRecall : mr < q.modelFP;
        const abstains = ab < q.abstain;
        const shownType = modelYes ? (positive && tr < q.typeRight ? type : type === "offer" ? "status_update" : "offer") : null;
        const model: VerifiedOutput = {
          key: "k", status: "ok", recruiting: modelYes, type: shownType as VerifiedOutput["type"], stage: null, company: modelYes && positive ? `Employer ${opp}` : null, companySource: modelYes && positive ? "quote" : null,
          role: null, dateText: null, certainty: abstains ? "low" : "high", evidence: modelYes ? { hash: "h", offset: 0 } : null, rejections: [],
        };
        out = resolveRecord(rec, model, new Date(arrivedAt.getTime() + 86400000), ug < q.ungrounded ? 1 : 0);
        population.plannedReads += 1;
      }
      records.push(out);
      if (candidate) { population.candidateRows += 1; if (!plannedRead) population.vetoed += 1; }
      else if (legacyMatch) population.legacyOnlyRows += 1;
      else if (arm) population.nonCandidateArmRows += 1;
    }
  }
  return { records, truth, population };
}

export const ingestionFactsOf = (r: ShadowRecord): IngestionFacts => ({
  userGoogleSub: r.userGoogleSub, gmailMessageId: r.gmailMessageId, gmailThreadId: r.gmailThreadId, arrivedAt: r.arrivedAt,
  readerVersion: r.readerVersion, pipelineVersion: r.pipelineVersion, extractorVersion: r.extractorVersion,
  cohort: r.cohort, uniformArm: r.uniformArm, isCandidate: r.isCandidate, plannedRead: r.plannedRead,
});

/** The full workflow on synthetic data: select the label set from ingestion facts, label from the planted truth, analyze. */
export function runSyntheticPipeline(p: SyntheticParams) {
  const { records, truth, population } = generateSynthetic(p);
  const selected: Selected[] = selectLabelSet(records.map(ingestionFactsOf));
  const byId = new Map(records.map((r) => [r.gmailMessageId, r]));
  const rows: AnalysisRow[] = selected.map((s) => {
    const t = truth.get(s.gmailMessageId)!;
    return toAnalysisRow(byId.get(s.gmailMessageId)!, s, { positive: t.positive, type: t.type, company: t.company, role: t.role ?? (t.positive ? "not_applicable" : null), opportunity: t.opportunity });
  });
  return { records, selected, rows, truth, population, analysis: computeAnalysis(rows, population) };
}

export const isSynthetic = (r: { messageId: string; mailbox: string }) => r.messageId.startsWith(SYNTHETIC_PREFIX) || r.mailbox.startsWith("synthetic-");

/** The real analysis must never ingest fixture rows, and the synthetic run must never ingest real ones. */
export function assertAllReal(rows: Array<{ messageId: string; mailbox: string }>) {
  const bad = rows.filter(isSynthetic).length;
  if (bad > 0) throw new Error(`refusing to analyze: ${bad} synthetic fixture rows among the evidence`);
}
export function assertAllSynthetic(rows: Array<{ messageId: string; mailbox: string }>) {
  const bad = rows.filter((r) => !isSynthetic(r)).length;
  if (bad > 0) throw new Error(`refusing synthetic run: ${bad} rows are not fixtures`);
}
