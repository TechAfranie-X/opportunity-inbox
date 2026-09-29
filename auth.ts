import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    jwt({ token, account }) {
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
