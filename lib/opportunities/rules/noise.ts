import { STRONG_SIGNAL_WEIGHT, type Evidence } from "../types.ts";
import type { RuleContext } from "./context.ts";

type NoiseRule = {
  signal: string;
  intent: Evidence["intent"];
  pattern: RegExp;
};

const NOISE_RULES: NoiseRule[] = [
  // Marketing / promotion
  { signal: "price drop", intent: "marketing_promotion", pattern: /\bprice drops?\b/ },
  { signal: "% off", intent: "marketing_promotion", pattern: /%\s*off\b/ },
  { signal: "discount", intent: "marketing_promotion", pattern: /\bdiscounts?\b/ },
  { signal: "sale", intent: "marketing_promotion", pattern: /\bsale\b/ },
  { signal: "flash sale", intent: "marketing_promotion", pattern: /\bflash sales?\b/ },
  { signal: "clearance", intent: "marketing_promotion", pattern: /\bclearance\b/ },
  { signal: "shop now", intent: "marketing_promotion", pattern: /\bshop now\b/ },
  { signal: "buy now", intent: "marketing_promotion", pattern: /\bbuy now\b/ },
  { signal: "special offer", intent: "marketing_promotion", pattern: /\bspecial offers?\b|\bexclusive offers?\b/ },
  { signal: "limited time", intent: "marketing_promotion", pattern: /\blimited[- ]time\b/ },
  { signal: "free shipping", intent: "marketing_promotion", pattern: /\bfree shipping\b/ },
  { signal: "vip", intent: "marketing_promotion", pattern: /\bvip\b/ },
  { signal: "new arrivals", intent: "marketing_promotion", pattern: /\bnew arrivals\b/ },
  { signal: "deal", intent: "marketing_promotion", pattern: /\bdeals?\b/ },
  { signal: "save", intent: "marketing_promotion", pattern: /\bsave\s*[%$]/ },

  // Transactional commerce
  { signal: "order", intent: "transactional_commerce", pattern: /(?<!\bin )\borders?\b/ },
  { signal: "shipping", intent: "transactional_commerce", pattern: /\bshipping\b|\b(?:has )?shipped\b|\byour cart\b/ },
  { signal: "receipt", intent: "transactional_commerce", pattern: /\breceipts?\b/ },

  // Content / newsletter
  { signal: "newsletter", intent: "content_newsletter", pattern: /\bnewsletters?\b|\bweekly digest\b|\bweekly update\b/ },
  { signal: "article", intent: "content_newsletter", pattern: /\barticles?\b/ },
  { signal: "documentary", intent: "content_newsletter", pattern: /\bdocumentar(?:y|ies)\b/ },
  { signal: "podcast", intent: "content_newsletter", pattern: /\bpodcasts?\b/ },
  { signal: "guide", intent: "content_newsletter", pattern: /\bguides?\b|\btutorials?\b/ },
  { signal: "short course", intent: "content_newsletter", pattern: /\bshort courses?\b|\bnew course\b|\bcourse launch\b/ },
  { signal: "how to", intent: "content_newsletter", pattern: /\bhow to\b|\blearn how to\b/ },
  { signal: "watch", intent: "content_newsletter", pattern: /\bwatch now\b|\bwatch our\b/ },
  { signal: "read more", intent: "content_newsletter", pattern: /\bread more\b/ },
  { signal: "tips", intent: "content_newsletter", pattern: /\btips?\b|\bcareer blog\b|\bblogs?\b/ },

  // Finance / account
  { signal: "credit report", intent: "finance_account", pattern: /\bcredit (?:score|report|monitoring|utilization)\b/ },
  { signal: "amount owed", intent: "finance_account", pattern: /\bamount owed\b/ },
  { signal: "loan", intent: "finance_account", pattern: /\bloans?\b|\bloan matches\b/ },
  { signal: "pre-approved", intent: "finance_account", pattern: /\bpre-approved\b/ },
  { signal: "statement", intent: "finance_account", pattern: /\bstatement (?:is )?ready\b|\baccount balance\b|\bpayment due\b|\bavailable credit\b|\bfinancial priorities\b/ },

  // Security / system
  { signal: "password reset", intent: "security_system", pattern: /\bpassword (?:reset|changed)\b/ },
  { signal: "2-step verification", intent: "security_system", pattern: /\b2[- ]step verification\b/ },
  { signal: "sign-in alert", intent: "security_system", pattern: /\bnew sign[- ]in\b|\bnew login\b|\bsign[- ]in (?:alert|detected)\b/ },
  { signal: "security alert", intent: "security_system", pattern: /\bsecurity alert\b|\baccount data shared\b|\baccount settings changed\b/ },
  { signal: "storage warning", intent: "security_system", pattern: /\bstorage (?:is )?(?:\d+%\s+)?(?:full|used)\b|\bstorage is \d+%/ },

  // Social / community
  { signal: "impressions", intent: "social_community", pattern: /\b(?:\d+\s+)?impressions\b/ },
  { signal: "likes", intent: "social_community", pattern: /\b(?:\d+\s+)?(?:new )?likes\b|\breactions?\b/ },
  { signal: "new invitations", intent: "social_community", pattern: /\b(?:\d+\s+)?new invitations\b/ },
  { signal: "connection suggestions", intent: "social_community", pattern: /\bconnection suggestions?\b|\bcommunity post\b/ },

  // Meeting system
  { signal: "meeting notification", intent: "meeting_system", pattern: /\b(?:has )?(?:joined|left) (?:your |the )?meeting\b/ },
  { signal: "meeting recording", intent: "meeting_system", pattern: /\b(?:cloud )?recording (?:is )?ready\b|\bcloud recording available\b|\bmeeting recording\b|\btranscript (?:is )?ready\b|\bmeeting summary\b/ },

  // Feedback / survey
  { signal: "survey", intent: "content_newsletter", pattern: /\b(?:quick |post-event |feedback )?survey\b|\bshare your (?:experience|feedback)\b|\brate (?:this |the |your )?(?:experience|event|interview)\b|\bgive feedback\b|\btell us how we did\b/ },
];

export function matchNoise(context: RuleContext): Evidence[] {
  const matched: Evidence[] = [];
  for (const rule of NOISE_RULES) {
    if (rule.pattern.test(context.subject)) {
      matched.push({
        signal: rule.signal,
        intent: rule.intent,
        dimension: "noise",
        weight: STRONG_SIGNAL_WEIGHT,
      });
    }
  }
  return matched;
}
