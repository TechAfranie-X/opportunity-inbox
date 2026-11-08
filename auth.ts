import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { SAMPLE_EMAIL, SAMPLE_NAME, SAMPLE_SUB, isSampleLoginEnabled } from "@/lib/gmail/sample";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,

  providers: [
    Google({
      authorization: {
        params: {
          scope: "openid email profile",
        },
      },
    }),
    // Development only: signs in the synthetic sample user. Absent unless SAMPLE_LOGIN=1 and NODE_ENV is not production.
    ...(isSampleLoginEnabled()
      ? [Credentials({ id: "sample", name: "Sample mailbox", credentials: {}, authorize: async () => ({ id: SAMPLE_SUB, email: SAMPLE_EMAIL, name: SAMPLE_NAME }) })]
      : []),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    jwt({ token, account }) {
      if (account?.provider === "sample" && isSampleLoginEnabled()) token.googleSub = SAMPLE_SUB;
      if (
        account?.provider === "google" &&
        typeof account.providerAccountId === "string"
      ) {
        token.googleSub = account.providerAccountId;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.googleSub === "string") {
        session.user.googleSub = token.googleSub;
      }
      return session;
    },
  },
});
