import type { EmailIntentFamily, OpportunityLabel } from "./types.ts";

export const GROUND_TRUTH_STORAGE_KEY = "opportunity-inbox:eval:ground-truth";

export type GroundTruthLabel = "opportunity" | "not_opportunity" | "skip";
export type DecidedGroundTruth = "opportunity" | "not_opportunity";

export type EvaluationFilter =
  | "all"
  | "unlabeled"
  | "opportunity"
  | "not_opportunity"
  | "needs_review"
  | "false_positives"
  | "false_negatives"
  | "needs_review_opportunity"
  | "needs_review_not_opportunity"
  | "skipped";

export type EvaluationMetrics = {
  total: number;
  labeled: number;
  skipped: number;
  unlabeled: number;
  opportunityGroundTruth: number;
  notOpportunityGroundTruth: number;
  autoResolved: number;
  needsReview: number;
  autoResolutionRate: number;
  escalationRate: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  autoResolvedLabeled: number;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  missedOpportunities: number;
  falseOpportunities: number;
  needsReviewOpportunity: number;
  needsReviewNotOpportunity: number;
  needsReviewSkipped: number;
};

export type BenchmarkExportRow = {
  gmailMessageId: string;
  classifierPrediction: OpportunityLabel;
  groundTruth: GroundTruthLabel | null;
  intent: EmailIntentFamily;
  pipelineScore: number;
  opportunityScore: number;
  noiseScore: number;
  bulkScore: number;
  directnessScore: number;
  matchedSignals: string[];
};

export function parseGroundTruthStore(
  raw: string | null,
): Record<string, GroundTruthLabel> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, GroundTruthLabel> = {};
    for (const [id, label] of Object.entries(parsed)) {
      if (
        label === "opportunity" ||
        label === "not_opportunity" ||
        label === "skip"
      ) {
        result[id] = label;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function serializeGroundTruthStore(
  store: Record<string, GroundTruthLabel>,
): string {
  return JSON.stringify(store);
}

export function setGroundTruthLabel(
  store: Record<string, GroundTruthLabel>,
  messageId: string,
  label: GroundTruthLabel | null,
): Record<string, GroundTruthLabel> {
  const next = { ...store };
  if (label === null) {
    delete next[messageId];
  } else {
    next[messageId] = label;
  }
  return next;
}

export function isDecidedGroundTruth(
  label: GroundTruthLabel | undefined,
): label is DecidedGroundTruth {
  return label === "opportunity" || label === "not_opportunity";
}

export function isIncorrectPrediction(
  predicted: OpportunityLabel,
  actual: GroundTruthLabel | undefined,
): boolean {
  if (!isDecidedGroundTruth(actual) || predicted === "unknown") {
    return false;
  }
  return predicted !== actual;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function computeEvaluationMetrics(
  messages: Array<{ id: string; classificationLabel: OpportunityLabel }>,
  groundTruth: Record<string, GroundTruthLabel>,
): EvaluationMetrics {
  const total = messages.length;
  let labeled = 0;
  let skipped = 0;
  let opportunityGroundTruth = 0;
  let notOpportunityGroundTruth = 0;
  let autoResolved = 0;
  let needsReview = 0;
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let needsReviewOpportunity = 0;
  let needsReviewNotOpportunity = 0;
  let needsReviewSkipped = 0;

  for (const message of messages) {
    const predicted = message.classificationLabel;
    if (predicted === "unknown") {
      needsReview += 1;
    } else {
      autoResolved += 1;
    }

    const actual = groundTruth[message.id];
    if (actual === undefined) {
      continue;
    }

    if (actual === "skip") {
      skipped += 1;
      if (predicted === "unknown") {
        needsReviewSkipped += 1;
      }
      continue;
    }

    labeled += 1;
    if (actual === "opportunity") {
      opportunityGroundTruth += 1;
    } else {
      notOpportunityGroundTruth += 1;
    }

    if (predicted === "unknown") {
      if (actual === "opportunity") {
        needsReviewOpportunity += 1;
      } else {
        needsReviewNotOpportunity += 1;
      }
      continue;
    }

    if (predicted === "opportunity" && actual === "opportunity") {
      truePositives += 1;
    } else if (
      predicted === "not_opportunity" &&
      actual === "not_opportunity"
    ) {
      trueNegatives += 1;
    } else if (predicted === "opportunity" && actual === "not_opportunity") {
      falsePositives += 1;
    } else if (predicted === "not_opportunity" && actual === "opportunity") {
      falseNegatives += 1;
    }
  }

  const autoResolvedLabeled =
    truePositives + trueNegatives + falsePositives + falseNegatives;

  return {
    total,
    labeled,
    skipped,
    unlabeled: total - labeled - skipped,
    opportunityGroundTruth,
    notOpportunityGroundTruth,
    autoResolved,
    needsReview,
    autoResolutionRate: total === 0 ? 0 : autoResolved / total,
    escalationRate: total === 0 ? 0 : needsReview / total,
    truePositives,
    trueNegatives,
    falsePositives,
    falseNegatives,
    autoResolvedLabeled,
    accuracy: ratio(truePositives + trueNegatives, autoResolvedLabeled),
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
    missedOpportunities: falseNegatives,
    falseOpportunities: falsePositives,
    needsReviewOpportunity,
    needsReviewNotOpportunity,
    needsReviewSkipped,
  };
}

export function isBenchmarkComplete(metrics: EvaluationMetrics) {
  return metrics.total > 0 && metrics.unlabeled === 0;
}

export function filterEvaluationMessages<
  T extends { id: string; classificationLabel: OpportunityLabel },
>(
  messages: T[],
  groundTruth: Record<string, GroundTruthLabel>,
  filter: EvaluationFilter,
): T[] {
  if (filter === "all") {
    return messages;
  }

  return messages.filter((message) => {
    const predicted = message.classificationLabel;
    const actual = groundTruth[message.id];

    switch (filter) {
      case "unlabeled":
        return actual === undefined;
      case "opportunity":
        return predicted === "opportunity";
      case "not_opportunity":
        return predicted === "not_opportunity";
      case "needs_review":
        return predicted === "unknown";
      case "false_positives":
        return predicted === "opportunity" && actual === "not_opportunity";
      case "false_negatives":
        return predicted === "not_opportunity" && actual === "opportunity";
      case "needs_review_opportunity":
        return predicted === "unknown" && actual === "opportunity";
      case "needs_review_not_opportunity":
        return predicted === "unknown" && actual === "not_opportunity";
      case "skipped":
        return actual === "skip";
    }
  });
}

export function unlabeledMessageIds<T extends { id: string }>(
  messages: T[],
  groundTruth: Record<string, GroundTruthLabel>,
) {
  return messages
    .filter((message) => groundTruth[message.id] === undefined)
    .map((message) => message.id);
}

export function nextUnlabeledMessageId<T extends { id: string }>(
  messages: T[],
  groundTruth: Record<string, GroundTruthLabel>,
  currentId: string | null,
) {
  const unlabeled = unlabeledMessageIds(messages, groundTruth);
  if (unlabeled.length === 0) {
    return null;
  }
  if (!currentId) {
    return unlabeled[0];
  }

  const currentIndex = messages.findIndex((message) => message.id === currentId);
  for (let index = currentIndex + 1; index < messages.length; index += 1) {
    if (groundTruth[messages[index].id] === undefined) {
      return messages[index].id;
    }
  }
  return unlabeled[0] ?? null;
}

export function previousUnlabeledMessageId<T extends { id: string }>(
  messages: T[],
  groundTruth: Record<string, GroundTruthLabel>,
  currentId: string | null,
) {
  const unlabeled = unlabeledMessageIds(messages, groundTruth);
  if (unlabeled.length === 0) {
    return null;
  }
  if (!currentId) {
    return unlabeled[unlabeled.length - 1];
  }

  const currentIndex = messages.findIndex((message) => message.id === currentId);
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (groundTruth[messages[index].id] === undefined) {
      return messages[index].id;
    }
  }
  return unlabeled[unlabeled.length - 1] ?? null;
}

export function buildBenchmarkExport(
  messages: Array<{
    id: string;
    classificationLabel: OpportunityLabel;
    intent: EmailIntentFamily;
    pipelineScore: number;
    opportunityScore: number;
    noiseScore: number;
    bulkScore: number;
    directnessScore: number;
    matchedSignals: string[];
  }>,
  groundTruth: Record<string, GroundTruthLabel>,
): BenchmarkExportRow[] {
  return messages.map((message) => ({
    gmailMessageId: message.id,
    classifierPrediction: message.classificationLabel,
    groundTruth: groundTruth[message.id] ?? null,
    intent: message.intent,
    pipelineScore: message.pipelineScore,
    opportunityScore: message.opportunityScore,
    noiseScore: message.noiseScore,
    bulkScore: message.bulkScore,
    directnessScore: message.directnessScore,
    matchedSignals: [...message.matchedSignals],
  }));
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatAccuracy(accuracy: number | null): string {
  if (accuracy === null) {
    return "n/a";
  }
  return `${(accuracy * 100).toFixed(1)}%`;
}
