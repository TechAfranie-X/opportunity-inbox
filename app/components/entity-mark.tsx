import { brandFor } from "@/lib/identity/resolve";
import { entityState, monogram, type EntityState } from "@/lib/recruiting/presentation";
import type { Opportunity } from "@/lib/recruiting/types";

const LABEL: Record<EntityState, string> = { known: "", likely: "Likely company, needs confirmation", unknown: "Company unknown" };

/**
 * Company identity, matched to the trust model. A well-known employer shows its public mark (bundled with the app: nothing is fetched, no
 * company name leaves the machine, a mark can never load slowly or break layout) in one quiet monochrome tile. A company we have no mark
 * for gets a monogram, never a guessed logo. A likely company is drawn dashed and softer, and says so to assistive technology; an unknown
 * company is a dashed placeholder. The mark is decoration: the company name is always written beside it.
 */
export function EntityMark({ opportunity, name, state: given, size = "md" }: { opportunity?: Pick<Opportunity, "company" | "events">; name?: string | null; state?: EntityState; size?: "sm" | "md" | "lg" }) {
  const state: EntityState = given ?? (opportunity ? entityState(opportunity) : name ? "known" : "unknown");
  const company = opportunity ? opportunity.company : name ?? null;
  const brand = state === "unknown" ? null : brandFor(company);
  const dim = size === "lg" ? "h-11 w-11 text-[0.9375rem]" : size === "sm" ? "h-7 w-7 text-[0.6875rem]" : "h-9 w-9 text-[0.8125rem]";
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-md font-semibold tracking-tight ${dim} ${
        state === "known" ? "bg-tint text-ink-2" : "border border-dashed border-[var(--line-strong)] text-ink-3"
      }`}
      title={LABEL[state] || undefined}
    >
      {brand ? (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={`${size === "lg" ? "h-[1.375rem] w-[1.375rem]" : size === "sm" ? "h-4 w-4" : "h-5 w-5"} ${state === "known" ? "text-ink" : "text-ink-2"}`}>
          <path d={brand.path} />
        </svg>
      ) : (
        <span aria-hidden>{monogram(company)}</span>
      )}
      {LABEL[state] ? <span className="sr-only">{LABEL[state]}</span> : null}
    </span>
  );
}
