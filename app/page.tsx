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

export default async function Home({ searchParams }: PageProps<"/">) {
  const session = await auth();
  const sub = session?.user?.googleSub;
  const params = await searchParams;
  const gmailError = typeof params.gmail === "string" ? GMAIL_ERRORS[params.gmail] : undefined;
  const connection = sub && isDatabaseConfigured() ? await findGmailConnection(sub) : null;

  // Connected users go straight to the product; the landing page is only for onboarding.
  if (connection && !gmailError) redirect("/today");

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-[42rem] items-baseline justify-between px-6 pt-6">
        <p className="text-[0.9375rem] font-semibold tracking-tight">Opportunity Inbox</p>
        <Link href="/demo" className="link-quiet">
          See a demo
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[42rem] flex-1 flex-col justify-center px-6 pb-24 pt-20">
        <h1 className="t-display max-w-[14ch]">Know where every application stands.</h1>
        <p className="t-lead mt-6 max-w-[40ch] text-ink-2">
          Connect Gmail and your recruiting is rebuilt from the emails you already have, then every morning you see what needs you.
        </p>

        <div className="mt-9 flex items-center gap-5">
          {!session?.user ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button type="submit" className="btn-primary">
                Continue with Google
              </button>
            </form>
          ) : (
            <form action="/api/gmail/connect" method="post">
              <button type="submit" className="btn-primary">
                Connect Gmail
              </button>
            </form>
          )}
        </div>
        {gmailError ? (
          <p className="t-meta mt-4 text-signal" role="alert">
            {gmailError}
          </p>
        ) : null}

        <dl className="mt-24 max-w-[34rem] border-t border-line">
          {[
            ["Read-only", "We can't send, delete or change anything in your mailbox."],
            ["Your emails aren't stored", "We keep the company, stage and dates, plus a link back to the email. Never the message text."],
            ["Yours to correct", "Fix anything we get wrong, or delete everything in one click."],
          ].map(([term, detail]) => (
            <div key={term} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
              <dt className="font-medium tracking-tight">{term}</dt>
              <dd className="text-ink-2">{detail}</dd>
            </div>
          ))}
        </dl>
      </main>
    </div>
  );
}
