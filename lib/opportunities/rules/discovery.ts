import { STRONG_SIGNAL_WEIGHT, type Evidence } from "../types.ts";
import type { RuleContext } from "./context.ts";

const DISCOVERY_RULES: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "new job matches", pattern: /\b(?:\d+\s+)?(?:new )?job matches\b/ },
  { signal: "job matches", pattern: /\bweekly job matches\b|\byour weekly job matches\b/ },
  { signal: "recommended jobs", pattern: /\brecommended jobs\b/ },
  { signal: "jobs you may like", pattern: /\bjobs you may like\b/ },
  { signal: "jobs for you", pattern: /\bjobs for you\b/ },
  { signal: "new roles for you", pattern: /\bnew roles for you\b/ },
  { signal: "roles matching profile", pattern: /\broles matching your profile\b/ },
  { signal: "job alert", pattern: /\b(?:weekly )?job alerts?\b|\bweekly job suggestions\b/ },
  { signal: "dream job", pattern: /\bdream job (?:is )?waiting\b/ },
  { signal: "new matches", pattern: /\bnew matches\b/ },
];

export function matchCareerDiscovery(context: RuleContext): Evidence[] {
  const matched: Evidence[] = [];
  for (const rule of DISCOVERY_RULES) {
    if (rule.pattern.test(context.subject)) {
      matched.push({
        signal: rule.signal,
        intent: "career_discovery",
        dimension: "noise",
        weight: STRONG_SIGNAL_WEIGHT,
      });
    }
  }
  return matched;
}
