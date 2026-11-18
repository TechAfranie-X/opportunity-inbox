/**
 * Curated full-colour brand assets, bundled under public/brands (fetched once by a developer from each company's own published icon and
 * reviewed by eye; the product never fetches a logo at run time). They take priority over the single-colour glyphs in logos.ts.
 *  - "bleed": the asset is a complete app-style icon with its own background (Harvey, Neuralink, Brex): it fills the tile, rounded.
 *  - "inset": a free-standing mark on transparency: it sits inside the neutral tile with padding.
 * Alias keys are flat normalized names ("harvey", "harveyai"); the lookup always starts from the canonical resolved company name.
 */
export type BrandAsset = { name: string; src: string; fit: "bleed" | "inset"; aliases?: string[] };

export const BRAND_ASSETS: Record<string, BrandAsset> = {
  harvey: { name: "Harvey", src: "/brands/harvey.png", fit: "bleed", aliases: ["harveyai"] },
  ramp: { name: "Ramp", src: "/brands/ramp.png", fit: "inset", aliases: ["rampnetwork"] },
  plaid: { name: "Plaid", src: "/brands/plaid.svg", fit: "inset" },
  figma: { name: "Figma", src: "/brands/figma.svg", fit: "inset" },
  google: { name: "Google", src: "/brands/google.png", fit: "inset", aliases: ["googlellc", "alphabet"] },
  slack: { name: "Slack", src: "/brands/slack.png", fit: "inset" },
  toast: { name: "Toast", src: "/brands/toast.png", fit: "inset", aliases: ["toasttab"] },
  waymo: { name: "Waymo", src: "/brands/waymo.png", fit: "inset" },
  neuralink: { name: "Neuralink", src: "/brands/neuralink.png", fit: "bleed" },
  brex: { name: "Brex", src: "/brands/brex.png", fit: "bleed" },
};
