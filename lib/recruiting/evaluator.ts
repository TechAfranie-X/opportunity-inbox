import { createHash } from "node:crypto";
import { companyKey, roleRelation } from "./company.ts";
import { DATASET_KINDS, HEADLINE_SOURCES, LABEL_SOURCES, NOT_APPLICABLE, UNKNOWN, type DatasetKind, type LabelField, type LabelSource } from "./ground-truth.ts";
import { DEFAULT_POLICY, decide, type Policy } from "./policy.ts";
import type { Prediction } from "./predictions.ts";

/**
 * Deterministic evaluation of predictions against frozen human labels.
 *
 * Pure: no clock, no randomness, no I/O. The same inputs always give the same report, so a run can be
 * reproduced exactly from (dataset, labels, predictions, policy, asOf).
 *
 * Denominators are explicit. A field only counts where a person gave it a real value: a message nobody labeled,
 * or one labeled "unknown", is excluded and counted separately rather than silently inflating accuracy.
 */

export type LabelRow = {
  gmailMessageId: string;
  field: LabelField;
  value: unknown;
  source: LabelSource;
  createdAt: Date | string | number;
};

export type EvalInput = {
  kind: DatasetKind;
  datasetName: string;
  /** BLIND only: false means this is not the first run, so the result is contaminated. */
  official?: boolean;
  /** The reference "now" the urgency labels were made against. */
  asOf: Date;
  /** Frozen dataset membership. Messages outside it are ignored. */
  messageIds: string[];
  /** Thread id of every member (from the dataset items), so unpredicted messages still belong to a thread. */
  threadOf: Map<string, string>;
  labels: LabelRow[];
  /** One prediction per message, all from the same extractor version. */
  predictions: Prediction[];
  /** The product's own grouping of the predicted events: message id -> opportunity id. */
  predictedGroups: Map<string, string>;
  /** Thread ids of the actions the product would show as needing attention today (overdue or today). */
  predictedTodayThreads: Set<string>;
  /** Label sources to count. Defaults to fresh-human-only for DEV-RANDOM and BLIND; everything for DEV-CHALLENGE. */
  sources?: LabelSource[];
  policy?: Policy;
  /** Confidence thresholds for the risk-coverage table. */
  thresholds?: number[];
};

export type Rate = { k: number; n: number; value: number | null; ci: [number, number] | null };

/** Wilson score interval (95%). Honest about small samples, unlike a bare percentage. */
export function rate(k: number, n: number): Rate {
  if (n === 0) return { k, n, value: null, ci: null };
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, value: p, ci: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}

const f1 = (p: number | null, r: number | null) => (p === null || r === null || p + r === 0 ? null : (2 * p * r) / (p + r));

export type EvalReport = {
  kind: DatasetKind;
  datasetName: string;
  official: boolean | null;
  /** What this number may and may not be used for. Always printed with the metrics. */
  banner: string;
  asOf: string;
  labelSources: LabelSource[];
  /** Fingerprint of the resolved label set (message, field, value) that was scored, so two runs are comparable only when it matches. */
  labelSetHash: string;
  excludedLabelRows: Partial<Record<LabelSource, number>>;
  coverage: { messages: number; labeledRecruiting: number; unlabeled: number; unpredicted: number };
  recruiting: { tp: number; fp: number; fn: number; tn: number; precision: Rate; recall: Rate; f1: number | null };
  type: { accuracy: Rate; accuracyWhenDetected: Rate; confidentWrong: Rate; unknownLabels: number };
  company: { exact: Rate; normalized: Rate; confidentWrong: Rate; abstained: Rate; unknownLabels: number;
    /** Of recruiting messages whose employer the labeler could not tell, how many did the system name one anyway. */
    overreach: Rate };
  role: { accuracy: Rate; exact: Rate; unknownLabels: number };
  date: { accuracy: Rate };
  grouping: { precision: Rate; recall: Rate; f1: number | null; truePairs: number; predictedPairs: number };
  today: { precision: Rate; recall: Rate };
  abstention: { reviewRate: Rate; unknownCompanyRate: Rate };
  riskCoverage: Array<{ threshold: number; coverage: Rate; typeAccuracy: Rate; companyAccuracy: Rate }>;
};

export const BANNERS: Record<DatasetKind, string> = {
  dev_random: "DEV-RANDOM: honest development metric on a frozen random sample of the development mailbox. Not blind: the extractor was developed against this mailbox.",
  dev_challenge: "DEV-CHALLENGE: curated hard and regression cases that are optimised against freely. NEVER a generalisation estimate.",
  blind: "BLIND: mailbox the extractor was never developed against. Only the first run is official; any later run is contaminated.",
};

const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
const isReal = (v: unknown): v is string => typeof v === "string" && v !== UNKNOWN && v !== NOT_APPLICABLE;

/** The latest human value per (message, field) among the allowed sources. Append-only rows resolve by time, then input order. */
export function resolveLabels(rows: LabelRow[], sources: LabelSource[]) {
  const allowed = new Set(sources);
  const latest = new Map<string, { at: number; seq: number; value: unknown }>();
  rows.forEach((row, seq) => {
    if (!allowed.has(row.source)) return;
    const key = `${row.gmailMessageId}\u0000${row.field}`;
    const at = new Date(row.createdAt).getTime();
    const cur = latest.get(key);
    if (!cur || at > cur.at || (at === cur.at && seq > cur.seq)) latest.set(key, { at, seq, value: row.value });
  });
  const byMessage = new Map<string, Partial<Record<LabelField, unknown>>>();
  for (const [key, { value }] of latest) {
    const [id, field] = key.split("\u0000");
    const m = byMessage.get(id) ?? {};
    m[field as LabelField] = value;
    byMessage.set(id, m);
  }
  return byMessage;
}

function pairKeys(groupOf: Map<string, string>, ids: string[]) {
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const g = groupOf.get(id);
    if (g === undefined) continue;
    buckets.set(g, [...(buckets.get(g) ?? []), id]);
  }
  const pairs = new Set<string>();
  for (const members of buckets.values()) {
    const sorted = [...members].sort();
    for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < sorted.length; j += 1) pairs.add(`${sorted[i]}|${sorted[j]}`);
  }
  return pairs;
}

export function evaluate(input: EvalInput): EvalReport {
  const policy = input.policy ?? DEFAULT_POLICY;
  const sources = input.sources ?? (input.kind === "dev_challenge" ? [...LABEL_SOURCES] : HEADLINE_SOURCES);
  if (!DATASET_KINDS.includes(input.kind)) throw new Error(`unknown dataset kind: ${input.kind}`);
  if (input.kind !== "dev_challenge" && sources.some((s) => !HEADLINE_SOURCES.includes(s))) {
    throw new Error(`${input.kind} headline metrics may only use ${HEADLINE_SOURCES.join(" / ")} labels; legacy_reconstructed and user_correction labels belong in DEV-CHALLENGE`);
  }

  const members = new Set(input.messageIds);
  const inSet = input.labels.filter((l) => members.has(l.gmailMessageId));
  const excluded: Partial<Record<LabelSource, number>> = {};
  for (const l of inSet) if (!sources.includes(l.source)) excluded[l.source] = (excluded[l.source] ?? 0) + 1;
  const labels = resolveLabels(inSet, sources);

  const predictions = new Map<string, Prediction>();
  for (const p of input.predictions) {
    if (!members.has(p.gmailMessageId)) continue;
    if (predictions.has(p.gmailMessageId)) throw new Error(`more than one prediction for ${p.gmailMessageId}: evaluate one extractor version at a time`);
    predictions.set(p.gmailMessageId, p);
  }

  // Policy-adjusted view of each prediction: the value a person would actually be shown.
  const view = (p: Prediction | undefined) => {
    if (!p || p.decision !== "recruiting") return { recruiting: false as const };
    const conf = (field: string) => p.fieldConfidence?.[field] ?? p.confidence ?? 0;
    return {
      recruiting: true as const,
      type: decide(p.type, conf("type"), policy, "type"),
      company: decide(p.company, conf("company"), policy, "company"),
      role: decide(p.role, conf("role"), policy, "role"),
      confidence: p.confidence ?? 0,
      date: p.eventDate,
    };
  };

  let tp = 0, fp = 0, fn = 0, tn = 0, unlabeled = 0, unpredicted = 0;
  const cnt = {
    typeK: 0, typeN: 0, typeDetK: 0, typeDetN: 0, typeCwK: 0, typeCwN: 0, typeUnknown: 0,
    coExK: 0, coNormK: 0, coN: 0, coCwK: 0, coCwN: 0, coAbst: 0, coUnknown: 0, coOverK: 0,
    roleK: 0, roleExK: 0, roleN: 0, roleUnknown: 0,
    dateK: 0, dateN: 0,
    reviewK: 0, reviewN: 0, unkCoK: 0, unkCoN: 0,
  };
  const recruitingIds: string[] = [];
  const sweep = input.thresholds ?? [0, 0.5, 0.6, 0.7, 0.8, 0.9];
  const sweepRows = sweep.map((t) => ({ t, covK: 0, covN: 0, typeK: 0, typeN: 0, coK: 0, coN: 0 }));

  for (const id of [...members].sort()) {
    const label = labels.get(id);
    const truth = label?.is_recruiting;
    const p = predictions.get(id);
    if (!p) unpredicted += 1;
    const v = view(p);

    if (typeof truth === "boolean") {
      if (truth && v.recruiting) tp += 1;
      else if (truth && !v.recruiting) fn += 1;
      else if (!truth && v.recruiting) fp += 1;
      else tn += 1;
    } else unlabeled += 1;

    // Abstention is measured over everything the product would show as recruiting, labeled or not.
    if (v.recruiting) {
      cnt.reviewN += 1;
      if (v.confidence < policy.reviewBelow || v.company.state !== "accepted") cnt.reviewK += 1;
      cnt.unkCoN += 1;
      if (v.company.value === null) cnt.unkCoK += 1;
    }

    if (truth !== true) continue;
    recruitingIds.push(id);

    // type
    const lt = label?.type;
    if (isReal(lt)) {
      cnt.typeN += 1;
      const ok = v.recruiting && v.type.value === lt;
      if (ok) cnt.typeK += 1;
      if (v.recruiting) {
        cnt.typeDetN += 1;
        if (ok) cnt.typeDetK += 1;
        if (v.type.state === "accepted") { cnt.typeCwN += 1; if (!ok) cnt.typeCwK += 1; }
      }
    } else if (lt === UNKNOWN) cnt.typeUnknown += 1;

    // company
    const lc = label?.company;
    if (isReal(lc)) {
      cnt.coN += 1;
      const pc = v.recruiting ? v.company.value : null;
      if (pc !== null && norm(pc) === norm(lc)) cnt.coExK += 1;
      if (pc !== null && companyKey(pc) === companyKey(lc)) cnt.coNormK += 1;
      if (!v.recruiting || pc === null) cnt.coAbst += 1;
      else if (v.company.state === "accepted") { cnt.coCwN += 1; if (companyKey(pc) !== companyKey(lc)) cnt.coCwK += 1; }
    } else if (lc === UNKNOWN) {
      cnt.coUnknown += 1;
      if (v.recruiting && v.company.value !== null) cnt.coOverK += 1;
    }

    // role: a label of not_applicable means "no role is stated", so predicting none is correct
    const lr = label?.role;
    if (isReal(lr) || lr === NOT_APPLICABLE) {
      cnt.roleN += 1;
      const pr = v.recruiting ? v.role.value : null;
      if (lr === NOT_APPLICABLE) { if (pr === null) { cnt.roleK += 1; cnt.roleExK += 1; } }
      else if (pr !== null) {
        if (roleRelation(pr, lr as string) === "match") cnt.roleK += 1;
        if (norm(pr) === norm(lr as string)) cnt.roleExK += 1;
      }
    } else if (lr === UNKNOWN) cnt.roleUnknown += 1;

    // date (day granularity, floating times are stored as UTC)
    const ld = label?.event_date;
    if (isReal(ld) || ld === NOT_APPLICABLE) {
      cnt.dateN += 1;
      const pd = v.recruiting ? v.date : null;
      if (ld === NOT_APPLICABLE ? pd === null : pd !== null && sameDay(pd, new Date(ld as string))) cnt.dateK += 1;
    }

    // risk-coverage: only messages the product would show, at each confidence floor
    if (v.recruiting) {
      for (const row of sweepRows) {
        const shown = v.confidence >= row.t;
        row.covN += 1;
        if (!shown) continue;
        row.covK += 1;
        if (isReal(lt)) { row.typeN += 1; if (v.type.value === lt) row.typeK += 1; }
        if (isReal(lc)) { row.coN += 1; if (v.company.value !== null && companyKey(v.company.value) === companyKey(lc)) row.coK += 1; }
      }
    }
  }

  // grouping: pairwise precision/recall over the recruiting-labeled messages that carry an opportunity label
  const trueGroups = new Map<string, string>();
  for (const id of recruitingIds) {
    const ref = labels.get(id)?.opportunity_ref;
    if (isReal(ref)) trueGroups.set(id, ref);
  }
  const groupIds = [...trueGroups.keys()];
  const predGroups = new Map<string, string>();
  for (const id of groupIds) predGroups.set(id, input.predictedGroups.get(id) ?? `__ungrouped:${id}`);
  const truePairs = pairKeys(trueGroups, groupIds);
  const predPairs = pairKeys(predGroups, groupIds);
  let pairTp = 0;
  for (const k of predPairs) if (truePairs.has(k)) pairTp += 1;
  const gp = rate(pairTp, predPairs.size), gr = rate(pairTp, truePairs.size);

  // today: thread level. A thread is urgent if any message in it is labeled urgency "today".
  const urgentThreads = new Set<string>();
  const labeledThreads = new Set<string>();
  for (const id of recruitingIds) {
    const th = input.threadOf.get(id);
    const u = labels.get(id)?.urgency;
    if (th === undefined || typeof u !== "string") continue;
    labeledThreads.add(th);
    if (u === "today") urgentThreads.add(th);
  }
  // Only judge predicted-Today threads that had a labeled message; an unlabeled thread is unknown, not wrong.
  const judged = [...input.predictedTodayThreads].filter((t) => labeledThreads.has(t));
  const todayTp = judged.filter((t) => urgentThreads.has(t)).length;
  const recalled = [...urgentThreads].filter((t) => input.predictedTodayThreads.has(t)).length;

  const recP = rate(tp, tp + fp), recR = rate(tp, tp + fn);
  return {
    kind: input.kind,
    datasetName: input.datasetName,
    official: input.kind === "blind" ? (input.official ?? null) : null,
    banner: input.kind === "blind" && input.official === false ? `CONTAMINATED. ${BANNERS.blind}` : BANNERS[input.kind],
    asOf: input.asOf.toISOString(),
    labelSources: sources,
    labelSetHash: labelSetHash(labels, members),
    excludedLabelRows: excluded,
    coverage: { messages: members.size, labeledRecruiting: recruitingIds.length, unlabeled, unpredicted },
    recruiting: { tp, fp, fn, tn, precision: recP, recall: recR, f1: f1(recP.value, recR.value) },
    type: { accuracy: rate(cnt.typeK, cnt.typeN), accuracyWhenDetected: rate(cnt.typeDetK, cnt.typeDetN), confidentWrong: rate(cnt.typeCwK, cnt.typeCwN), unknownLabels: cnt.typeUnknown },
    company: { exact: rate(cnt.coExK, cnt.coN), normalized: rate(cnt.coNormK, cnt.coN), confidentWrong: rate(cnt.coCwK, cnt.coCwN), abstained: rate(cnt.coAbst, cnt.coN), unknownLabels: cnt.coUnknown, overreach: rate(cnt.coOverK, cnt.coUnknown) },
    role: { accuracy: rate(cnt.roleK, cnt.roleN), exact: rate(cnt.roleExK, cnt.roleN), unknownLabels: cnt.roleUnknown },
    date: { accuracy: rate(cnt.dateK, cnt.dateN) },
    grouping: { precision: gp, recall: gr, f1: f1(gp.value, gr.value), truePairs: truePairs.size, predictedPairs: predPairs.size },
    today: { precision: rate(todayTp, judged.length), recall: rate(recalled, urgentThreads.size) },
    abstention: { reviewRate: rate(cnt.reviewK, cnt.reviewN), unknownCompanyRate: rate(cnt.unkCoK, cnt.unkCoN) },
    riskCoverage: sweepRows.map((r) => ({ threshold: r.t, coverage: rate(r.covK, r.covN), typeAccuracy: rate(r.typeK, r.typeN), companyAccuracy: rate(r.coK, r.coN) })),
  };
}

/** sha256 over the sorted (message, field, value) triples of the resolved labels for this dataset's members. */
export function labelSetHash(labels: Map<string, Partial<Record<LabelField, unknown>>>, members: Set<string>) {
  const lines: string[] = [];
  for (const [id, fields] of labels) {
    if (!members.has(id)) continue;
    for (const [field, value] of Object.entries(fields)) lines.push(`${id}|${field}|${JSON.stringify(value)}`);
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex").slice(0, 16);
}

/** Of the recruiting predictions people were shown, how many did they correct? Computed from user_correction labels. */
export function correctionRate(shownMessageIds: string[], corrections: LabelRow[]) {
  const shown = new Set(shownMessageIds);
  const corrected = new Set(corrections.filter((c) => c.source === "user_correction" && shown.has(c.gmailMessageId)).map((c) => c.gmailMessageId));
  return rate(corrected.size, shown.size);
}

const pct = (r: Rate) => (r.value === null ? "n/a" : `${(r.value * 100).toFixed(1)}% [${(r.ci![0] * 100).toFixed(0)}-${(r.ci![1] * 100).toFixed(0)}] (${r.k}/${r.n})`);

/** Plain-text report. The banner always comes first so a number is never read without its meaning. */
export function formatReport(r: EvalReport): string {
  const lines = [
    r.banner,
    `dataset ${r.datasetName} (${r.kind})${r.official === null ? "" : r.official ? " · OFFICIAL RUN" : " · CONTAMINATED RUN"} · as of ${r.asOf.slice(0, 10)}`,
    `labels counted: ${r.labelSources.join(", ")} · label set ${r.labelSetHash}${Object.keys(r.excludedLabelRows).length ? ` · excluded: ${JSON.stringify(r.excludedLabelRows)}` : ""}`,
    `messages ${r.coverage.messages} · labeled recruiting ${r.coverage.labeledRecruiting} · unlabeled ${r.coverage.unlabeled} · no prediction ${r.coverage.unpredicted}`,
    "",
    `recruiting   precision ${pct(r.recruiting.precision)}   recall ${pct(r.recruiting.recall)}   F1 ${r.recruiting.f1 === null ? "n/a" : r.recruiting.f1.toFixed(3)}`,
    `type         accuracy ${pct(r.type.accuracy)}   when detected ${pct(r.type.accuracyWhenDetected)}   confident-wrong ${pct(r.type.confidentWrong)}`,
    `company      exact ${pct(r.company.exact)}   normalized ${pct(r.company.normalized)}   confident-wrong ${pct(r.company.confidentWrong)}   abstained ${pct(r.company.abstained)}   overreach (named an employer the labeler could not) ${pct(r.company.overreach)}`,
    `role         accuracy ${pct(r.role.accuracy)}   exact ${pct(r.role.exact)}`,
    `date         accuracy ${pct(r.date.accuracy)}`,
    `grouping     pair precision ${pct(r.grouping.precision)}   recall ${pct(r.grouping.recall)}   F1 ${r.grouping.f1 === null ? "n/a" : r.grouping.f1.toFixed(3)}`,
    `today        precision ${pct(r.today.precision)}   recall ${pct(r.today.recall)}`,
    `abstention   review rate ${pct(r.abstention.reviewRate)}   unknown company ${pct(r.abstention.unknownCompanyRate)}`,
    "",
    "risk-coverage (shown at confidence >= t):",
    ...r.riskCoverage.map((c) => `  t=${c.threshold.toFixed(2)}  coverage ${pct(c.coverage)}  type ${pct(c.typeAccuracy)}  company ${pct(c.companyAccuracy)}`),
  ];
  return lines.join("\n");
}
