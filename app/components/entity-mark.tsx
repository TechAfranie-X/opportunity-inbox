import { entityState, monogram, type EntityState } from "@/lib/recruiting/presentation";
import type { Opportunity } from "@/lib/recruiting/types";

const LABEL: Record<EntityState, string> = { known: "", likely: "Likely company, needs confirmation", unknown: "Company unknown" };

/**
 * Company identity without fabrication. We never fetch or invent a logo (that would send company names to a third party, and guess when
 * unsure); the mark is a monogram. Its treatment says how much we know: solid for known, dashed for a likely name that needs confirming,
 * a dashed question mark when there is nothing. The state is also written for assistive technology.
 */
export function EntityMark({ opportunity, name, state: given, size = "md" }: { opportunity?: Pick<Opportunity, "company" | "events">; name?: string | null; state?: EntityState; size?: "sm" | "md" | "lg" }) {
  const state: EntityState = given ?? (opportunity ? entityState(opportunity) : name ? "known" : "unknown");
  const company = opportunity ? opportunity.company : name ?? null;
  const dim = size === "lg" ? "h-11 w-11 text-[0.9375rem]" : size === "sm" ? "h-7 w-7 text-[0.6875rem]" : "h-9 w-9 text-[0.8125rem]";
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-md font-semibold tracking-tight ${dim} ${
        state === "known" ? "bg-tint text-ink-2" : "border border-dashed border-[var(--line-strong)] text-ink-3"
      }`}
      title={LABEL[state] || undefined}
    >
      <span aria-hidden>{monogram(company)}</span>
      {LABEL[state] ? <span className="sr-only">{LABEL[state]}</span> : null}
    </span>
  );
}
