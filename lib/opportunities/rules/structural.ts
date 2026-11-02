import { WEAK_SIGNAL_WEIGHT, type Evidence } from "../types.ts";
import type { RuleContext } from "./context.ts";

export function matchStructural(context: RuleContext): Evidence[] {
  const matched: Evidence[] = [];

  if (context.listUnsubscribe) {
    matched.push({
      signal: "header:list-unsubscribe",
      intent: "unknown",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.listId) {
    matched.push({
      signal: "header:list-id",
      intent: "content_newsletter",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.autoSubmitted && !/^(?:no|false)$/.test(context.autoSubmitted)) {
    matched.push({
      signal: "header:auto-submitted",
      intent: "unknown",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (/\bbulk\b|\blist\b/.test(context.precedence)) {
    matched.push({
      signal: "header:precedence-bulk",
      intent: "unknown",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.provider.promotional) {
    matched.push({
      signal: "provider:promotional",
      intent: "marketing_promotion",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.provider.social) {
    matched.push({
      signal: "provider:social",
      intent: "social_community",
      dimension: "bulk",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.provider.personal) {
    matched.push({
      signal: "provider:personal",
      intent: "personal_direct",
      dimension: "directness",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.provider.important) {
    matched.push({
      signal: "provider:important",
      intent: "unknown",
      dimension: "directness",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  if (context.provider.starred) {
    matched.push({
      signal: "provider:starred",
      intent: "unknown",
      dimension: "directness",
      weight: WEAK_SIGNAL_WEIGHT,
      weak: true,
    });
  }

  return matched;
}
