import {
  EMPTY_PROVIDER_SIGNALS,
  type ProviderSignals,
} from "../opportunities/types.ts";

export function providerSignalsFromGmailLabels(
  labelIds: string[] | undefined,
): ProviderSignals {
  const labels = new Set(labelIds ?? []);

  return {
    ...EMPTY_PROVIDER_SIGNALS,
    promotional: labels.has("CATEGORY_PROMOTIONS"),
    social: labels.has("CATEGORY_SOCIAL"),
    updates: labels.has("CATEGORY_UPDATES"),
    personal: labels.has("CATEGORY_PERSONAL"),
    important: labels.has("IMPORTANT"),
    starred: labels.has("STARRED"),
  };
}
