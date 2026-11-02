import { hasContentFrame, stripSubjectAnnotations } from "../normalize.ts";
import { STRONG_SIGNAL_WEIGHT, type Evidence } from "../types.ts";
import type { RuleContext } from "./context.ts";

const PIPELINE_RULES: Array<{ signal: string; pattern: RegExp }> = [
  {
    signal: "application received",
    pattern:
      /\b(?:we received your application|your application has been received|application received|thank you for applying)\b/,
  },
  {
    signal: "application submitted",
    pattern: /\bapplications? (?:has been )?submitted\b/,
  },
  {
    signal: "application status",
    pattern: /\bapplication status\b|\byour application status changed\b/,
  },
  {
    signal: "application update",
    pattern: /\bapplication updates?\b/,
  },
  {
    signal: "candidacy update",
    pattern: /\bcandidacy (?:status|update)s?\b|\bcandidate status\b/,
  },
  {
    signal: "screening",
    pattern: /\b(?:phone screen|recruiter screen|screening)\b/,
  },
  {
    signal: "coding assessment",
    pattern:
      /\b(?:coding |online |technical )?assessments?\b|\bcomplete your assessment\b/,
  },
  {
    signal: "coding challenge",
    pattern: /\bcoding challenges?\b/,
  },
  {
    signal: "interview scheduling",
    pattern:
      /\b(?:schedule|scheduling|availability|confirmation|invitation)(?:\s+\w+){0,3}\s+interviews?\b|\binterviews? (?:availability|confirmation|invitation|scheduling|scheduled)\b|\bschedule(?: your)? interview\b/,
  },
  {
    signal: "next round",
    pattern: /\b(?:next|final) rounds?\b/,
  },
  {
    signal: "moving forward",
    pattern: /\b(?:not (?:be )?)?mov(?:e|ing) forward\b/,
  },
  {
    signal: "recruiter outreach",
    pattern: /\brecruiter outreach\b/,
  },
  {
    signal: "offer letter",
    pattern:
      /\boffer letters?\b|\boffer extended\b|\bextend(?:ed)? you an offer\b|\bpleased to extend you an offer\b/,
  },
  {
    signal: "reference check",
    pattern: /\breference checks?\b/,
  },
  {
    signal: "background check",
    pattern: /\bbackground checks?\b/,
  },
  {
    signal: "rejection",
    pattern:
      /\bwe will not be moving forward\b|\bwe regret to inform\b|\bapplication (?:has been )?(?:declined|rejected)\b/,
  },
  {
    signal: "hired",
    pattern:
      /\b(?:you've been hired|you have been hired|you are hired|selected for (?:the )?(?:role|position|internship))\b/,
  },
  {
    signal: "assessment expired",
    pattern: /\b(?:assessment|request) (?:has )?(?:expired|expiration|expires)\b/,
  },
];

const GENERIC_PIPELINE_RULES: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "interview", pattern: /\binterviews?\b/ },
  { signal: "recruiter", pattern: /\brecruiters?\b/ },
];

export function matchCareerPipeline(context: RuleContext): Evidence[] {
  const matched: Evidence[] = [];

  for (const rule of PIPELINE_RULES) {
    if (rule.pattern.test(context.subject)) {
      matched.push({
        signal: rule.signal,
        intent: "career_pipeline",
        dimension: "pipeline",
        weight: STRONG_SIGNAL_WEIGHT,
      });
    }
  }

  if (!context.contentFrame) {
    for (const rule of GENERIC_PIPELINE_RULES) {
      if (rule.pattern.test(context.subject)) {
        matched.push({
          signal: rule.signal,
          intent: "career_pipeline",
          dimension: "pipeline",
          weight: STRONG_SIGNAL_WEIGHT,
        });
      }
    }
  }

  return matched;
}

export function subjectHasStrongPipeline(subject: string) {
  const normalized = stripSubjectAnnotations(subject);
  return matchCareerPipeline({
    subject: normalized,
    sender: {
      text: "",
      displayName: "",
      localPart: "",
      domain: "",
      email: "",
    },
    listUnsubscribe: "",
    listId: "",
    autoSubmitted: "",
    precedence: "",
    provider: {
      promotional: false,
      social: false,
      updates: false,
      personal: false,
      important: false,
      starred: false,
    },
    contentFrame: hasContentFrame(normalized),
  }).some((item) => item.weight >= STRONG_SIGNAL_WEIGHT);
}
