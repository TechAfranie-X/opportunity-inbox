import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { saveGmailConnection } from "@/lib/gmail/credentials";
import {
  GMAIL_READONLY_SCOPE,
  clearGmailOAuthCookies,
  emailsMatch,
  exchangeGmailAuthorizationCode,
  getGmailProfile,
  readGmailOAuthCookies,
} from "@/lib/gmail/oauth";

function redirectHome(request: Request, error?: string) {
  const url = new URL("/", request.url);
  if (error) {
    url.searchParams.set("gmail", error);
  }
  const response = NextResponse.redirect(url);
  clearGmailOAuthCookies(response.cookies);
  return response;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return redirectHome(request);
  }
  if (!session.user.googleSub || !session.user.email) {
    return redirectHome(request, "reauth");
  }
  if (!isDatabaseConfigured()) {
    return redirectHome(request, "failed");
  }

  const incoming = new URL(request.url);
  if (incoming.searchParams.get("error")) {
    return redirectHome(request, "denied");
  }

  const code = incoming.searchParams.get("code");
  const returnedState = incoming.searchParams.get("state");
  const { state, verifier } = readGmailOAuthCookies(await cookies());

  if (!code || !returnedState || !state || !verifier || returnedState !== state) {
    return redirectHome(request, "failed");
  }

  try {
    const origin = process.env.AUTH_URL ?? incoming.origin;
    const tokens = await exchangeGmailAuthorizationCode({
      origin,
      code,
      verifier,
    });

    if (!tokens.refreshToken) {
      return redirectHome(request, "missing_refresh_token");
    }

    const profile = await getGmailProfile(tokens.accessToken);
    if (!emailsMatch(profile.emailAddress, session.user.email)) {
      return redirectHome(request, "mailbox_mismatch");
    }

    await saveGmailConnection({
      userGoogleSub: session.user.googleSub,
      gmailEmail: profile.emailAddress,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope ?? GMAIL_READONLY_SCOPE,
    });

    return redirectHome(request);
  } catch {
    return redirectHome(request, "failed");
  }
}
