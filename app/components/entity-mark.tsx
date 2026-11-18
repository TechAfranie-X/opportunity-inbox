import { brandFor } from "@/lib/identity/resolve";
import { entityState, monogram, type EntityState } from "@/lib/recruiting/presentation";
import type { Opportunity } from "@/lib/recruiting/types";

const LABEL: Record<EntityState, string> = { known: "", likely: "Likely company, needs confirmation", unknown: "Company unknown" };

/** One size scale for every surface: compact (rows, search, recent changes), standard (cards), large (Today rows, detail). */
const SIZE = {
  sm: { box: "h-7 w-7 text-[0.6875rem]", mark: "h-[1.0625rem] w-[1.0625rem]", px: 28 },
  md: { box: "h-9 w-9 text-[0.8125rem]", mark: "h-[1.3125rem] w-[1.3125rem]", px: 36 },
  lg: { box: "h-11 w-11 text-[0.9375rem]", mark: "h-[1.625rem] w-[1.625rem]", px: 44 },
  xl: { box: "h-14 w-14 rounded-[0.625rem] text-[1.125rem]", mark: "h-8 w-8", px: 56 },
} as const;

/**
 * Company identity as a product component, matched to the trust model. Identity is resolved first; the mark follows it (never the other way):
 *  - a known employer with a curated full-colour asset shows it; with a bundled glyph, the glyph in its official brand colour;
 *    app-style icons (Harvey) fill the tile, free-standing marks sit inside it with padding; very light brands sit on a dark tile;
 *  - a likely employer shows the same mark, untouched, in a dashed ring ("please confirm"), and says so to assistive technology;
 *  - a company with no public mark keeps the monogram; an unknown company is a dashed placeholder. A logo is never invented or guessed.
 * Assets are bundled and fixed-size, so nothing loads late or shifts layout. The company name is always written beside the mark.
 */
export function EntityMark({ opportunity, name, state: given, size = "md" }: { opportunity?: Pick<Opportunity, "company" | "events">; name?: string | null; state?: EntityState; size?: "sm" | "md" | "lg" | "xl" }) {
  const state: EntityState = given ?? (opportunity ? entityState(opportunity) : name ? "known" : "unknown");
  const company = opportunity ? opportunity.company : name ?? null;
  const brand = state === "unknown" ? null : brandFor(company);
  const s = SIZE[size];
  const tone = brand?.light ? "dark" : brand ? (brand.fit === "bleed" ? "bleed" : "light") : state === "unknown" ? "none" : "plain";
  return (
    <span className={`logo-tile ${s.box}`} data-state={state} data-tone={tone === "dark" || tone === "plain" ? tone : undefined} title={LABEL[state] || undefined}>
      {brand ? (
        // eslint-disable-next-line @next/next/no-img-element -- bundled, fixed-size brand asset; nothing to optimize or lazy-load
        <img src={brand.src} alt="" width={s.px} height={s.px} draggable={false} loading="lazy" decoding="async" className={brand.fit === "bleed" ? "h-full w-full object-cover" : `${s.mark} object-contain`} />
      ) : (
        <span aria-hidden>{monogram(company)}</span>
      )}
      {LABEL[state] ? <span className="sr-only">{LABEL[state]}</span> : null}
    </span>
  );
}
