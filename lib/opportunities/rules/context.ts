import type { ParsedSender } from "../normalize.ts";
import type { ProviderSignals } from "../types.ts";

export type RuleContext = {
  subject: string;
  sender: ParsedSender;
  listUnsubscribe: string;
  listId: string;
  autoSubmitted: string;
  precedence: string;
  provider: ProviderSignals;
  contentFrame: boolean;
};
