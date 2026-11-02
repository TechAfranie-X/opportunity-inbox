import { domainMatches } from "../normalize.ts";
import { MODERATE_SIGNAL_WEIGHT, WEAK_SIGNAL_WEIGHT, type Evidence } from "../types.ts";
import type { RuleContext } from "./context.ts";

const CAREER_LOCAL_PARTS = [
  "recruiting",
  "recruiter",
  "talent",
  "careers",
  "campus",
  "campusrecruiting",
  "universityrecruiting",
  "earlycareers",
] as const;

const MARKETING_LOCAL_PARTS = [
  "marketing",
  "newsletter",
  "promotions",
  "offers",
  "deals",
  "sales",
] as const;

const NEUTRAL_LOCAL_PARTS = ["noreply", "no-reply", "no_reply", "donotreply"] as const;

const JOB_PLATFORM_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkday.com",
  "myworkdayjobs.com",
  "icims.com",
  "smartrecruiters.com",
  "jobvite.com",
  "handshake.com",
  "simplify.jobs",
] as const;

const OPTIONAL_NOISE_DOMAINS = [
  { signal: "knowledge:commerce", domains: ["jomashop.com"] },
  { signal: "knowledge:credit", domains: ["experian.com"] },
  { signal: "knowledge:education-marketing", domains: ["deeplearning.ai"] },
] as const;

function localPartTokens(localPart: string) {
  return localPart.split(/[._+-]+/).filter(Boolean);
}

function hasLocalPart(localPart: string, listed: readonly string[]) {
  const tokens = localPartTokens(localPart);
  return listed.some((entry) => tokens.includes(entry) || localPart === entry);
}

function matchOptionalAwsMarketing(context: RuleContext): Evidence[] {
  if (/\bamazon web services\b/.test(context.sender.displayName)) {
    return [
      {
        signal: "knowledge:aws-marketing",
        intent: "marketing_promotion",
        dimension: "noise",
        weight: MODERATE_SIGNAL_WEIGHT,
      },
    ];
  }

  const isAmazonDomain =
    context.sender.domain === "amazon.com" ||
    context.sender.domain.endsWith(".amazon.com");
  if (isAmazonDomain && /(?:^|[._-])aws(?:$|[._-])/.test(context.sender.localPart)) {
    return [
      {
        signal: "knowledge:aws-marketing",
        intent: "marketing_promotion",
        dimension: "noise",
        weight: MODERATE_SIGNAL_WEIGHT,
      },
    ];
  }

  return [];
}

export function matchSender(context: RuleContext): Evidence[] {
  const matched: Evidence[] = [];
  const { localPart, domain, displayName } = context.sender;

  if (hasLocalPart(localPart, NEUTRAL_LOCAL_PARTS)) {
    // ATS and recruiting systems often use no-reply addresses.
  } else if (
    hasLocalPart(localPart, CAREER_LOCAL_PARTS) ||
    /\b(?:recruit(?:er|ing|ment)|careers?|talent|hiring)\b/.test(displayName)
  ) {
    matched.push({
      signal: "sender:career-role",
      intent: "career_pipeline",
      dimension: "directness",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  } else if (hasLocalPart(localPart, MARKETING_LOCAL_PARTS)) {
    matched.push({
      signal: "sender:marketing-role",
      intent: "marketing_promotion",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (JOB_PLATFORM_DOMAINS.some((entry) => domainMatches(domain, entry))) {
    matched.push({
      signal: "knowledge:job-platform",
      intent: "career_pipeline",
      dimension: "directness",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  for (const group of OPTIONAL_NOISE_DOMAINS) {
    if (group.domains.some((entry) => domainMatches(domain, entry))) {
      matched.push({
        signal: group.signal,
        intent:
          group.signal === "knowledge:credit"
            ? "finance_account"
            : group.signal === "knowledge:education-marketing"
              ? "content_newsletter"
              : "marketing_promotion",
        dimension: "noise",
        weight: MODERATE_SIGNAL_WEIGHT,
      });
    }
  }

  matched.push(...matchOptionalAwsMarketing(context));

  if (
    /\brecruit(?:er|ing|ment)\b/.test(context.sender.text) &&
    !matched.some((item) => item.signal === "sender:career-role")
  ) {
    matched.push({
      signal: "sender:career-role",
      intent: "career_pipeline",
      dimension: "directness",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  return matched;
}
