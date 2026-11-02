/**
 * Canonical brand names for registrable-domain labels whose spelling cannot be recovered from the text.
 * Curated from public facts about well-known brands, not from any mailbox. Invariant: one brand, one name,
 * so "makenotion.com" and "Notion" group together.
 */
export const BRAND_ALIASES: Record<string, string> = {
  makenotion: "Notion",
  datadoghq: "Datadog",
  jpmchase: "JPMorgan Chase",
  jpmorganchase: "JPMorgan Chase",
  bankofamerica: "Bank of America",
  fb: "Meta",
  facebook: "Meta",
};

export const flatKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export const canonicalBrand = (name: string): string => BRAND_ALIASES[flatKey(name)] ?? name;
