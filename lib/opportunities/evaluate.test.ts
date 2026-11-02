import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBenchmarkExport,
  computeEvaluationMetrics,
  filterEvaluationMessages,
  formatAccuracy,
  isBenchmarkComplete,
  isIncorrectPrediction,
  nextUnlabeledMessageId,
  parseGroundTruthStore,
  previousUnlabeledMessageId,
  setGroundTruthLabel,
} from "./evaluate.ts";

const messages = [
  { id: "tp", classificationLabel: "opportunity" as const },
  { id: "tn", classificationLabel: "not_opportunity" as const },
  { id: "fp", classificationLabel: "opportunity" as const },
  { id: "fn", classificationLabel: "not_opportunity" as const },
  { id: "review-opp", classificationLabel: "unknown" as const },
  { id: "review-noise", classificationLabel: "unknown" as const },
  { id: "unlabeled-auto", classificationLabel: "opportunity" as const },
  { id: "unlabeled-review", classificationLabel: "unknown" as const },
];

const groundTruth = {
  tp: "opportunity",
  tn: "not_opportunity",
  fp: "not_opportunity",
  fn: "opportunity",
  "review-opp": "opportunity",
  "review-noise": "not_opportunity",
} as const;

test("Needs review is an abstention, not an incorrect prediction", () => {
  const metrics = computeEvaluationMetrics(messages, { ...groundTruth });

  assert.equal(metrics.total, 8);
  assert.equal(metrics.labeled, 6);
  assert.equal(metrics.autoResolved, 5);
  assert.equal(metrics.needsReview, 3);
  assert.equal(metrics.truePositives, 1);
  assert.equal(metrics.trueNegatives, 1);
  assert.equal(metrics.falsePositives, 1);
  assert.equal(metrics.falseNegatives, 1);
  assert.equal(metrics.autoResolvedLabeled, 4);
  assert.equal(metrics.accuracy, 0.5);
  assert.equal(isIncorrectPrediction("unknown", "opportunity"), false);
  assert.equal(isIncorrectPrediction("unknown", "not_opportunity"), false);
});

test("auto-resolution and escalation rates are measured on the full sample", () => {
  const metrics = computeEvaluationMetrics(messages, { ...groundTruth });

  assert.equal(metrics.autoResolutionRate, 5 / 8);
  assert.equal(metrics.escalationRate, 3 / 8);
});

test("false negatives are missed opportunities and false positives are false opportunities", () => {
  const metrics = computeEvaluationMetrics(messages, { ...groundTruth });

  assert.equal(metrics.falseNegatives, 1);
  assert.equal(metrics.missedOpportunities, 1);
  assert.equal(metrics.falseOpportunities, 1);
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(
    isIncorrectPrediction("not_opportunity", "opportunity"),
    true,
  );
});

test("unlabeled messages do not affect confusion-matrix counts", () => {
  const metrics = computeEvaluationMetrics(
    [
      { id: "a", classificationLabel: "opportunity" },
      { id: "b", classificationLabel: "not_opportunity" },
    ],
    {},
  );

  assert.equal(metrics.labeled, 0);
  assert.equal(metrics.unlabeled, 2);
  assert.equal(metrics.truePositives, 0);
  assert.equal(metrics.falsePositives, 0);
  assert.equal(metrics.accuracy, null);
  assert.equal(metrics.precision, null);
  assert.equal(metrics.recall, null);
  assert.equal(formatAccuracy(null), "n/a");
  assert.equal(isBenchmarkComplete(metrics), false);
});

test("skip is stored human ground truth and is not a confusion-matrix label", () => {
  const metrics = computeEvaluationMetrics(messages, {
    ...groundTruth,
    "unlabeled-auto": "skip",
  });

  assert.equal(metrics.skipped, 1);
  assert.equal(metrics.unlabeled, 1);
  assert.equal(metrics.labeled, 6);
  assert.equal(metrics.truePositives, 1);
  assert.equal(isIncorrectPrediction("opportunity", "skip"), false);
});

test("needs review breakdown uses human labels without treating review as an error", () => {
  const metrics = computeEvaluationMetrics(
    [
      { id: "a", classificationLabel: "unknown" },
      { id: "b", classificationLabel: "unknown" },
      { id: "c", classificationLabel: "unknown" },
      { id: "d", classificationLabel: "unknown" },
    ],
    {
      a: "opportunity",
      b: "not_opportunity",
      c: "skip",
    },
  );

  assert.equal(metrics.needsReview, 4);
  assert.equal(metrics.needsReviewOpportunity, 1);
  assert.equal(metrics.needsReviewNotOpportunity, 1);
  assert.equal(metrics.needsReviewSkipped, 1);
  assert.equal(metrics.unlabeled, 1);
});

test("false-positive and false-negative filters only include auto-resolved disagreements", () => {
  const falsePositives = filterEvaluationMessages(
    messages,
    { ...groundTruth },
    "false_positives",
  );
  const falseNegatives = filterEvaluationMessages(
    messages,
    { ...groundTruth },
    "false_negatives",
  );

  assert.deepEqual(
    falsePositives.map((message) => message.id),
    ["fp"],
  );
  assert.deepEqual(
    falseNegatives.map((message) => message.id),
    ["fn"],
  );
});

test("unlabeled filter excludes skipped messages", () => {
  const unlabeled = filterEvaluationMessages(
    messages,
    { ...groundTruth, "unlabeled-auto": "skip" },
    "unlabeled",
  );

  assert.deepEqual(
    unlabeled.map((message) => message.id),
    ["unlabeled-review"],
  );
});

test("skipped and needs-review ground-truth filters work independently", () => {
  const skipped = filterEvaluationMessages(
    messages,
    { ...groundTruth, "unlabeled-auto": "skip" },
    "skipped",
  );
  const reviewOpportunity = filterEvaluationMessages(
    messages,
    { ...groundTruth },
    "needs_review_opportunity",
  );

  assert.deepEqual(
    skipped.map((message) => message.id),
    ["unlabeled-auto"],
  );
  assert.deepEqual(
    reviewOpportunity.map((message) => message.id),
    ["review-opp"],
  );
});

test("ground-truth store keeps only message id to human labels", () => {
  const parsed = parseGroundTruthStore(
    JSON.stringify({
      abc: "opportunity",
      def: "not_opportunity",
      skip: "skip",
      subject: "Internship at Acme",
    }),
  );

  assert.deepEqual(parsed, {
    abc: "opportunity",
    def: "not_opportunity",
    skip: "skip",
  });

  const unlabeled = setGroundTruthLabel(parsed, "abc", null);
  assert.equal("abc" in unlabeled, false);
  assert.equal(unlabeled.def, "not_opportunity");
});

test("next and previous unlabeled helpers wrap through the sample", () => {
  const sample = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const labels = { b: "opportunity" as const };

  assert.equal(nextUnlabeledMessageId(sample, labels, "a"), "c");
  assert.equal(nextUnlabeledMessageId(sample, labels, "c"), "a");
  assert.equal(previousUnlabeledMessageId(sample, labels, "c"), "a");
  assert.equal(previousUnlabeledMessageId(sample, labels, "a"), "c");
});

test("benchmark export omits subject and sender", () => {
  const exported = buildBenchmarkExport(
    [
      {
        id: "msg-1",
        classificationLabel: "unknown",
        intent: "unknown",
        pipelineScore: 0,
        opportunityScore: 0,
        noiseScore: 1,
        bulkScore: 1,
        directnessScore: 0,
        matchedSignals: ["provider:promotional"],
      },
    ],
    { "msg-1": "skip" },
  );

  assert.deepEqual(exported, [
    {
      gmailMessageId: "msg-1",
      classifierPrediction: "unknown",
      groundTruth: "skip",
      intent: "unknown",
      pipelineScore: 0,
      opportunityScore: 0,
      noiseScore: 1,
      bulkScore: 1,
      directnessScore: 0,
      matchedSignals: ["provider:promotional"],
    },
  ]);
  assert.equal("subject" in exported[0], false);
  assert.equal("from" in exported[0], false);
});

test("benchmark is complete only when every message has a human decision", () => {
  const complete = computeEvaluationMetrics(
    [
      { id: "a", classificationLabel: "opportunity" },
      { id: "b", classificationLabel: "unknown" },
    ],
    {
      a: "opportunity",
      b: "skip",
    },
  );

  assert.equal(complete.unlabeled, 0);
  assert.equal(complete.labeled, 1);
  assert.equal(complete.skipped, 1);
  assert.equal(isBenchmarkComplete(complete), true);
});
