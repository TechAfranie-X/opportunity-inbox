import { classificationFromEvidence } from "./evidence.ts";
import {
  hasContentFrame,
  normalizeText,
  parseSender,
  stripSubjectAnnotations,
} from "./normalize.ts";
import {
  matchCareerPipeline,
  subjectHasStrongPipeline,
} from "./rules/career-pipeline.ts";
import { matchDirectOpportunity } from "./rules/direct-opportunity.ts";
import { matchCareerDiscovery } from "./rules/discovery.ts";
import { matchNoise } from "./rules/noise.ts";
import { matchSender } from "./rules/sender.ts";
import { matchStructural } from "./rules/structural.ts";
import {
  EMPTY_PROVIDER_SIGNALS,
  STRONG_SIGNAL_WEIGHT,
  type ClassifyEmailInput,
  type Evidence,
  type OpportunityClassification,
  type OpportunityLabel,
} from "./types.ts";

export type {
  ClassifyEmailInput,
  EmailIntentFamily,
  OpportunityClassification,
  OpportunityLabel,
  ProviderSignals,
} from "./types.ts";

export {
  EMPTY_PROVIDER_SIGNALS,
  STRONG_SCORE_THRESHOLD as OPPORTUNITY_SCORE_THRESHOLD,
} from "./types.ts";

export { normalizeText, parseSender, stripSubjectAnnotations };

function threadEvidence(threadSubjects: string[] | undefined, subject: string): Evidence[] {
  if (!threadSubjects?.length) {
    return [];
  }

  const current = stripSubjectAnnotations(subject);
  const hasPipeline = threadSubjects.some((threadSubject) => {
    const normalized = stripSubjectAnnotations(threadSubject);
    return normalized !== current && subjectHasStrongPipeline(threadSubject);
  });

  if (!hasPipeline) {
    return [];
  }

  return [
    {
      signal: "thread:career-pipeline",
      intent: "career_pipeline",
      dimension: "pipeline",
      weight: STRONG_SIGNAL_WEIGHT,
    },
  ];
}

export function classifyOpportunityEmail(
  input: ClassifyEmailInput,
): OpportunityClassification {
  const subject = stripSubjectAnnotations(input.subject);
  const sender = parseSender(input.from);
  const context = {
    subject,
    sender,
    listUnsubscribe: normalizeText(input.listUnsubscribe ?? ""),
    listId: normalizeText(input.listId ?? ""),
    autoSubmitted: normalizeText(input.autoSubmitted ?? ""),
    precedence: normalizeText(input.precedence ?? ""),
    provider: input.providerSignals ?? EMPTY_PROVIDER_SIGNALS,
    contentFrame: hasContentFrame(subject),
  };

  const evidence = [
    ...matchCareerPipeline(context),
    ...matchDirectOpportunity(context),
    ...matchCareerDiscovery(context),
    ...matchNoise(context),
    ...matchSender(context),
    ...matchStructural(context),
    ...threadEvidence(input.threadSubjects, input.subject),
  ];

  return classificationFromEvidence(evidence);
}

export function classificationDisplayLabel(label: OpportunityLabel) {
  if (label === "opportunity") {
    return "Opportunity";
  }
  if (label === "not_opportunity") {
    return "Not opportunity";
  }
  return "Needs review";
}

export function classificationBadgeClass(label: OpportunityLabel) {
  if (label === "opportunity") {
    return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  }
  if (label === "not_opportunity") {
    return "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300";
  }
  return "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
}
