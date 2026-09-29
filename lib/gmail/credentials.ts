import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/gmail/crypto";

export async function findGmailConnection(userGoogleSub: string) {
  const [connection] = await getDb()
    .select({
      gmailEmail: gmailConnections.gmailEmail,
      connectedAt: gmailConnections.connectedAt,
    })
    .from(gmailConnections)
    .where(eq(gmailConnections.userGoogleSub, userGoogleSub))
    .limit(1);

  return connection ?? null;
}

export async function getGmailRefreshToken(userGoogleSub: string) {
  const [connection] = await getDb()
    .select({
      refreshTokenEnc: gmailConnections.refreshTokenEnc,
    })
    .from(gmailConnections)
    .where(eq(gmailConnections.userGoogleSub, userGoogleSub))
    .limit(1);

  if (!connection) {
    return null;
  }

  return decryptSecret(connection.refreshTokenEnc);
}

export async function saveGmailConnection(options: {
  userGoogleSub: string;
  gmailEmail: string;
  refreshToken: string;
  scope: string;
}) {
  const db = getDb();
  const refreshTokenEnc = encryptSecret(options.refreshToken);
  const values = {
    userGoogleSub: options.userGoogleSub,
    gmailEmail: options.gmailEmail,
    refreshTokenEnc,
    scope: options.scope,
    connectedAt: new Date(),
  };

  await db
    .insert(gmailConnections)
    .values(values)
    .onConflictDoUpdate({
      target: gmailConnections.userGoogleSub,
      set: {
        gmailEmail: values.gmailEmail,
        refreshTokenEnc: values.refreshTokenEnc,
        scope: values.scope,
        connectedAt: values.connectedAt,
      },
    });
}
