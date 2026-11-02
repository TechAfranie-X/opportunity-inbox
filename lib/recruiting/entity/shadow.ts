import type { EvalReport, Rate } from "../evaluator.ts";
import type { Prediction } from "../predictions.ts";
import type { CompanyResolution } from "./resolve.ts";

/**
 * Shadow mode: score the new resolver against the same frozen labels as the current pipeline, without letting it
 * drive the product. Only the company field of recruiting predictions is replaced.
 */
export function applyResolutions(predictions: Prediction[], resolutions: Map<string, CompanyResolution>): Prediction[] {
  return predictions.map((p) => {
    const res = resolutions.get(p.gmailMessageId);
    if (p.decision !== "recruiting" || !res) return p;
    return {
      ...p,
      company: res.entity?.name ?? null,
      fieldConfidence: { ...(p.fieldConfidence ?? {}), company: res.confidence },
      reviewReasons: res.reviewRequired ? [...p.reviewReasons, "company_review"] : p.reviewReasons,
      signals: [...p.signals, ...res.evidence.map((e) => `company:${e.source}`)],
    };
  });
}

const fmt = (r: Rate) => (r.value === null ? "n/a" : `${(r.value * 100).toFixed(1)}% (${r.k}/${r.n})`);
const delta = (a: Rate, b: Rate) => (a.value === null || b.value === null ? "" : `${b.value - a.value >= 0 ? "+" : ""}${((b.value - a.value) * 100).toFixed(1)} pts`);

/** Side-by-side company metrics. A better exact-match that comes with more confident-wrong answers is not better. */
export function formatShadowComparison(current: EvalReport, shadow: EvalReport): string {
  const row = (label: string, a: Rate, b: Rate) => `  ${label.padEnd(18)} current ${fmt(a).padEnd(18)} resolver ${fmt(b).padEnd(18)} ${delta(a, b)}`;
  return [
    `SHADOW COMPARISON on ${current.datasetName} (${current.kind}): company only. The resolver is not driving the product.`,
    row("exact match", current.company.exact, shadow.company.exact),
    row("normalized match", current.company.normalized, shadow.company.normalized),
    row("confident-wrong", current.company.confidentWrong, shadow.company.confidentWrong),
    row("abstained", current.company.abstained, shadow.company.abstained),
    row("review rate", current.abstention.reviewRate, shadow.abstention.reviewRate),
  ].join("\n");
}
