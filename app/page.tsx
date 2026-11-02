import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { findGmailConnection } from "@/lib/gmail/credentials";

const GMAIL_ERRORS: Record<string, string> = {
  missing_refresh_token: "Google did not grant offline access. Gmail was not connected.",
  mailbox_mismatch: "That Gmail inbox does not match the signed-in Google account.",
  reauth: "Please sign in again before connecting Gmail.",
  denied: "Gmail access was not granted.",
  failed: "Could not connect Gmail. Try again.",
};

const primaryButton =
  "appearance-none rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90";

export default async function Home({ searchParams }: PageProps<"/">) {
  const session = await auth();
  const sub = session?.user?.googleSub;
  const params = await searchParams;
  const gmailError = typeof params.gmail === "string" ? GMAIL_ERRORS[params.gmail] : undefined;
  const connection = sub && isDatabaseConfigured() ? await findGmailConnection(sub) : null;

  // Connected users go straight to the product; the landing page is only for onboarding.
  if (connection && !gmailError) redirect("/today");

  return (
    <div className="flex min-h-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <p className="text-sm font-semibold tracking-tight">Opportunity Inbox</p>
        <Link href="/demo" className="text-sm text-zinc-500 underline">See a demo</Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <div className="w-full max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Your recruiting, finally in one place.
          </h1>
          <p className="mt-5 text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Connect Gmail and Opportunity Inbox rebuilds your recruiting
            pipeline from the emails you already have: every application,
            assessment, recruiter, interview and offer, with a Today list of
            what needs you and what you might be about to miss.
          </p>

          <div className="mt-8">
            {!session?.user ? (
              <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
                <button type="submit" className={primaryButton}>Sign in with Google</button>
              </form>
            ) : (
              <form action="/api/gmail/connect" method="post">
                <button type="submit" className={primaryButton}>Connect Gmail</button>
              </form>
            )}
            {gmailError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{gmailError}</p> : null}
          </div>

          <ul className="mx-auto mt-10 max-w-md space-y-2 text-left text-sm text-zinc-600 dark:text-zinc-400">
            <li><strong className="text-foreground">Read-only.</strong> We can&apos;t send, delete or change anything in your mailbox.</li>
            <li><strong className="text-foreground">No email storage.</strong> We read messages to extract company, stage and dates, then keep only those facts, plus a link back to the email.</li>
            <li><strong className="text-foreground">You&apos;re in control.</strong> Correct anything we get wrong, or delete all derived data and disconnect in one click.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
