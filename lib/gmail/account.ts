import "server-only";

import { findGmailConnection } from "@/lib/gmail/credentials";
import { isSampleUser } from "@/lib/gmail/sample";
import { gmailAccountForLinks } from "@/lib/recruiting/format";

/** The Google account this person connected (the one their mail is read from), for building links that open the right Gmail account. Null when unknown. */
export async function connectedGmailAccount(userGoogleSub: string): Promise<string | null> {
  if (isSampleUser(userGoogleSub)) return null;
  try {
    return gmailAccountForLinks((await findGmailConnection(userGoogleSub))?.gmailEmail);
  } catch {
    return null; // a link without an account hint is better than a failed page
  }
}
