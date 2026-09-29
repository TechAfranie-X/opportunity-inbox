import { createHash, randomBytes } from "node:crypto";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

const STATE_COOKIE = "gmail_oauth_state";
const VERIFIER_COOKIE = "gmail_oauth_verifier";
const COOKIE_MAX_AGE = 10 * 60;

type CookieStore = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      secure: boolean;
      path: string;
      maxAge: number;
    },
  ) => void;
};

export function getGoogleOAuthConfig() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client is not configured");
  }

  return { clientId, clientSecret };
}

export function getGmailRedirectUri(origin: string) {
  return `${origin.replace(/\/$/, "")}/api/gmail/callback`;
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState() {
  return randomBytes(24).toString("base64url");
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

export function setGmailOAuthCookies(
  cookies: CookieStore,
  state: string,
  verifier: string,
) {
  const options = oauthCookieOptions();
  cookies.set(STATE_COOKIE, state, options);
  cookies.set(VERIFIER_COOKIE, verifier, options);
}

export function clearGmailOAuthCookies(cookies: CookieStore) {
  const options = { ...oauthCookieOptions(), maxAge: 0 };
  cookies.set(STATE_COOKIE, "", options);
  cookies.set(VERIFIER_COOKIE, "", options);
}

export function readGmailOAuthCookies(cookies: {
  get: (name: string) => { value: string } | undefined;
}) {
  return {
    state: cookies.get(STATE_COOKIE)?.value,
    verifier: cookies.get(VERIFIER_COOKIE)?.value,
  };
}

export function buildGmailAuthorizeUrl(options: {
  origin: string;
  state: string;
  challenge: string;
  loginHint?: string | null;
}) {
  const { clientId } = getGoogleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getGmailRedirectUri(options.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (options.loginHint) {
    url.searchParams.set("login_hint", options.loginHint);
  }
  return url;
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
};

export async function exchangeGmailAuthorizationCode(options: {
  origin: string;
  code: string;
  verifier: string;
}) {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const body = new URLSearchParams({
    code: options.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGmailRedirectUri(options.origin),
    grant_type: "authorization_code",
    code_verifier: options.verifier,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const tokens = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || tokens.error || !tokens.access_token) {
    throw new Error("Gmail token exchange failed");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope,
  };
}

type GmailProfile = {
  emailAddress?: string;
};

export async function getGmailProfile(accessToken: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Gmail profile lookup failed");
  }

  const profile = (await response.json()) as GmailProfile;
  if (!profile.emailAddress) {
    throw new Error("Gmail profile lookup failed");
  }

  return { emailAddress: profile.emailAddress };
}

export function emailsMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
