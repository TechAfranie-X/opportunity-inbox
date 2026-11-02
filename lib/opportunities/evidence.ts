import {
  STRONG_SCORE_THRESHOLD,
  WEAK_SCORE_CAP,
  type EmailIntentFamily,
  type Evidence,
  type EvidenceDimension,
  type OpportunityClassification,
  type OpportunityLabel,
} from "./types.ts";

function capScore(score: number, cap: number) {
  if (score > cap) {
    return cap;
  }
  if (score < 0) {
    return 0;
  }
  return score;
}

export function scoreDimension(evidence: Evidence[], dimension: EvidenceDimension) {
  const items = evidence.filter((item) => item.dimension === dimension);
  const strong = items
    .filter((item) => !item.weak)
    .reduce((sum, item) => sum + item.weight, 0);
  const weak = capScore(
    items.filter((item) => item.weak).reduce((sum, item) => sum + item.weight, 0),
    WEAK_SCORE_CAP,
  );
  return strong + weak;
}

function strongestNoiseIntent(evidence: Evidence[]): EmailIntentFamily {
  const counts = new Map<EmailIntentFamily, number>();
  for (const item of evidence) {
    if (item.dimension !== "noise") {
      continue;
    }
    counts.set(item.intent, (counts.get(item.intent) ?? 0) + item.weight);
  }

  let best: EmailIntentFamily = "unknown";
  let bestWeight = 0;
  for (const [intent, weight] of counts) {
    if (weight > bestWeight) {
      best = intent;
      bestWeight = weight;
    }
  }
  return best;
}

export function labelFromScores(input: {
  pipelineScore: number;
  opportunityScore: number;
  noiseScore: number;
}): OpportunityLabel {
  const strongPipeline = input.pipelineScore >= STRONG_SCORE_THRESHOLD;
  const strongDirect = input.opportunityScore >= STRONG_SCORE_THRESHOLD;
  const strongCareer = strongPipeline || strongDirect;
  const strongNoise = input.noiseScore >= STRONG_SCORE_THRESHOLD;

  if (strongCareer && strongNoise) {
    return "unknown";
  }
  if (strongCareer) {
    return "opportunity";
  }
  if (strongNoise) {
    return "not_opportunity";
  }
  return "unknown";
}

export function intentFromEvidence(
  label: OpportunityLabel,
  evidence: Evidence[],
  pipelineScore: number,
  opportunityScore: number,
): EmailIntentFamily {
  if (label === "opportunity") {
    return pipelineScore >= opportunityScore
      ? "career_pipeline"
      : "direct_opportunity";
  }
  if (label === "not_opportunity") {
    return strongestNoiseIntent(evidence);
  }
  return "unknown";
}

export function classificationFromEvidence(
  evidence: Evidence[],
): OpportunityClassification {
  const pipelineScore = scoreDimension(evidence, "pipeline");
  const opportunityScore = scoreDimension(evidence, "opportunity");
  const noiseScore = scoreDimension(evidence, "noise");
  const bulkScore = scoreDimension(evidence, "bulk");
  const directnessScore = scoreDimension(evidence, "directness");
  const careerScore = pipelineScore + opportunityScore;
  const label = labelFromScores({
    pipelineScore,
    opportunityScore,
    noiseScore,
  });

  return {
    label,
    intent: intentFromEvidence(label, evidence, pipelineScore, opportunityScore),
    pipelineScore,
    opportunityScore,
    noiseScore,
    bulkScore,
    directnessScore,
    careerScore,
    matchedSignals: evidence.map((item) => item.signal),
    score: careerScore - noiseScore,
  };
}
