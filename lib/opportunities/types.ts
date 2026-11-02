export type OpportunityLabel = "opportunity" | "not_opportunity" | "unknown";

export type EmailIntentFamily =
  | "career_pipeline"
  | "direct_opportunity"
  | "career_discovery"
  | "marketing_promotion"
  | "content_newsletter"
  | "transactional_commerce"
  | "finance_account"
  | "security_system"
  | "social_community"
  | "meeting_system"
  | "personal_direct"
  | "unknown";

export type EvidenceDimension =
  | "pipeline"
  | "opportunity"
  | "noise"
  | "bulk"
  | "directness";

export type ProviderSignals = {
  promotional: boolean;
  social: boolean;
  updates: boolean;
  personal: boolean;
  important: boolean;
  starred: boolean;
};

export type OpportunityClassification = {
  label: OpportunityLabel;
  intent: EmailIntentFamily;
  pipelineScore: number;
  opportunityScore: number;
  noiseScore: number;
  bulkScore: number;
  directnessScore: number;
  careerScore: number;
  matchedSignals: string[];
  score: number;
};

export type ClassifyEmailInput = {
  subject: string;
  from: string;
  listUnsubscribe?: string;
  listId?: string;
  autoSubmitted?: string;
  precedence?: string;
  providerSignals?: ProviderSignals;
  threadSubjects?: string[];
};

export type Evidence = {
  signal: string;
  intent: EmailIntentFamily;
  dimension: EvidenceDimension;
  weight: number;
  weak?: boolean;
};

export const EMPTY_PROVIDER_SIGNALS: ProviderSignals = {
  promotional: false,
  social: false,
  updates: false,
  personal: false,
  important: false,
  starred: false,
};

export const STRONG_SCORE_THRESHOLD = 3;
export const STRONG_SIGNAL_WEIGHT = 4;
export const MODERATE_SIGNAL_WEIGHT = 3;
export const WEAK_SIGNAL_WEIGHT = 1;
export const WEAK_SCORE_CAP = 1;
