import type {
  EmailIntentFamily,
  OpportunityLabel,
  ProviderSignals,
} from "@/lib/opportunities/types";

export type GmailInboxMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  classificationLabel: OpportunityLabel;
  intent: EmailIntentFamily;
  pipelineScore: number;
  opportunityScore: number;
  noiseScore: number;
  bulkScore: number;
  directnessScore: number;
  careerScore: number;
  matchedSignals: string[];
  gmailLabels: string[];
  providerSignals: ProviderSignals;
};
