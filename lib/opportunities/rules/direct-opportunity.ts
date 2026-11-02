import { STRONG_SIGNAL_WEIGHT, type Evidence } from "../types.ts";
import type { RuleContext } from "./context.ts";

const OPPORTUNITY_NOUNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "fellowship", pattern: /\bfellowships?\b/ },
  { signal: "scholarship", pattern: /\bscholarships?\b/ },
  { signal: "hackathon", pattern: /\bhackathons?\b/ },
  { signal: "internship", pattern: /\binternships?\b/ },
  { signal: "research program", pattern: /\bresearch (?:program|opportunity|opportunities)\b/ },
  {
    signal: "career event",
    pattern: /\b(?:career (?:conference|fair|event|events)|student tech career conference)\b/,
  },
  { signal: "conference", pattern: /\bconferences?\b/ },
];

const OPPORTUNITY_ACTIONS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "apply", pattern: /\bapply\b|\bapplication\b|\bapplications open\b/ },
  { signal: "register", pattern: /\bregister\b|\bregistration\b/ },
  { signal: "submit", pattern: /\bsubmit\b/ },
  { signal: "invited to apply", pattern: /\binvited to apply\b|\binvitation to apply\b/ },
  { signal: "nomination", pattern: /\bnominations?\b/ },
  { signal: "eligibility", pattern: /\beligibility\b/ },
  { signal: "deadline", pattern: /\bdeadlines?\b|\bby friday\b/ },
  { signal: "rsvp", pattern: /\brsvp\b/ },
  { signal: "sign up", pattern: /\bsign ups?\b/ },
  { signal: "next steps", pattern: /\bnext steps\b/ },
];

export function matchDirectOpportunity(context: RuleContext): Evidence[] {
  const nouns = OPPORTUNITY_NOUNS.filter((rule) => rule.pattern.test(context.subject));
  const actions = OPPORTUNITY_ACTIONS.filter((rule) =>
    rule.pattern.test(context.subject),
  );

  if (nouns.length === 0 || actions.length === 0) {
    return [];
  }

  if (context.contentFrame && !actions.some((action) => action.signal === "apply" || action.signal === "register" || action.signal === "invited to apply")) {
    return [];
  }

  return [
    {
      signal: `direct:${actions[0].signal}+${nouns[0].signal}`,
      intent: "direct_opportunity",
      dimension: "opportunity",
      weight: STRONG_SIGNAL_WEIGHT,
    },
    ...nouns.map((noun) => ({
      signal: noun.signal,
      intent: "direct_opportunity" as const,
      dimension: "opportunity" as const,
      weight: 0,
    })),
    ...actions.map((action) => ({
      signal: action.signal,
      intent: "direct_opportunity" as const,
      dimension: "opportunity" as const,
      weight: 0,
    })),
  ];
}
