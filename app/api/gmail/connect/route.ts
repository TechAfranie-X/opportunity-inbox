import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildGmailAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  setGmailOAuthCookies,
} from "@/lib/gmail/oauth";

function homeRedirect(request: Request, error?: string) {
  const url = new URL("/", request.url);
  if (error) {
    url.searchParams.set("gmail", error);
  }
  return NextResponse.redirect(url);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return homeRedirect(request);
  }
  if (!session.user.googleSub) {
    return homeRedirect(request, "reauth");
  }

  const origin = process.env.AUTH_URL?.trim() || new URL(request.url).origin;
  const state = createOAuthState();
  const { verifier, challenge } = createPkcePair();
  const authorizeUrl = buildGmailAuthorizeUrl({
    origin,
    state,
    challenge,
    loginHint: session.user.email,
  });

  const response = NextResponse.redirect(authorizeUrl);
  setGmailOAuthCookies(response.cookies, state, verifier);
  return response;
}
