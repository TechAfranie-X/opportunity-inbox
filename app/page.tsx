import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Mark } from "@/app/components/brand";
import { LandingPreview } from "@/app/components/landing-preview";
import { isDatabaseConfigured } from "@/lib/db";
import { findGmailConnection, saveGmailConnection } from "@/lib/gmail/credentials";
import { SAMPLE_EMAIL, SAMPLE_SUB, isSampleLoginEnabled } from "@/lib/gmail/sample";

const GMAIL_ERRORS: Record<string, string> = {
  missing_refresh_token: "Google did not grant offline access. Gmail was not connected.",
  mailbox_mismatch: "That Gmail inbox does not match the signed-in Google account.",
  reauth: "Please sign in again before connecting Gmail.",
  denied: "Gmail access was not granted.",
  failed: "Could not connect Gmail. Try again.",
};

const STEPS = [
  ["Connect Gmail", "Sign in with Google and approve one read-only permission."],
  ["We find the recruiting mail", "Applications, assessments, interviews, offers and rejections become opportunities. Everything else is ignored."],
  ["Act on what matters", "Today shows what needs you and what is next. Pipeline shows where everything stands. Fix anything we get wrong in a click."],
];

const TRUST = [
  ["Read-only", "We cannot send, delete or change anything in your mailbox."],
  ["Message text is never stored", "We keep the company, role, stage, dates and subject line, with a link back to the email."],
  ["No AI service reads your mail", "Nothing is sent to a model or any third party."],
  ["Yours to delete", "Remove everything we derived, or disconnect Gmail, from your account menu."],
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const session = await auth();
  const sub = session?.user?.googleSub;
  const params = await searchParams;
  const gmailError = typeof params.gmail === "string" ? GMAIL_ERRORS[params.gmail] : undefined;
  const connection = sub && isDatabaseConfigured() ? await findGmailConnection(sub) : null;

  // Connected users go straight to the product; the landing page is only for onboarding.
  if (connection && !gmailError) redirect("/today");

  /** One primary action, repeated at the end. Sign in first; once signed in, connect Gmail. */
  const cta = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      {!session?.user ? (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="btn-primary !h-11 !px-5 !text-[0.9375rem]">
            Continue with Google
          </button>
        </form>
      ) : (
        <form action="/api/gmail/connect" method="post">
          <button type="submit" className="btn-primary !h-11 !px-5 !text-[0.9375rem]">
            Connect Gmail
          </button>
        </form>
      )}
      <Link href="/demo" className="link-quiet !text-[0.9375rem]">
        Explore the demo
      </Link>
    </div>
  );

  return (
    <div className="relative flex min-h-full flex-col overflow-x-clip">
      <header className="mx-auto flex w-full max-w-[64rem] items-center justify-between px-6 pt-6 lg:px-10">
        <p className="flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-tight">
          <Mark />
          Opportunity Inbox
        </p>
        <Link href="/demo" className="link-quiet">
          Demo
        </Link>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-[64rem] px-6 pt-10 sm:pt-16 lg:px-10">
          <h1 className="t-hero max-w-[15ch]">Recruiting email in. A clear plan out.</h1>
          <p className="t-lead mt-5 max-w-[42ch] text-ink-2">
            Opportunity Inbox reads the recruiting mail already in your Gmail and turns it into one record of every application: what needs you now, what changed, and where each one stands.
          </p>
          <div className="mt-7">{cta}</div>
          {gmailError ? (
            <p className="t-meta mt-4 text-signal" role="alert">
              {gmailError}
            </p>
          ) : null}
          <p className="t-meta mt-4 text-ink-3">Read-only access. Your message text is never stored.</p>
          {isSampleLoginEnabled() && !session?.user ? (
            <form
              className="mt-3"
              action={async () => {
                "use server";
                if (!isSampleLoginEnabled()) return;
                // Seed a sample connection (a placeholder secret, never used) so the app treats the sample user as connected.
                await saveGmailConnection({ userGoogleSub: SAMPLE_SUB, gmailEmail: SAMPLE_EMAIL, refreshToken: "sample", scope: "sample" });
                await signIn("sample", { redirectTo: "/today" });
              }}
            >
              <button type="submit" className="link-quiet t-meta">
                Try with a sample mailbox (development)
              </button>
            </form>
          ) : null}
        </section>

        <section className="mx-auto mt-12 w-full max-w-[64rem] px-6 sm:mt-14 lg:px-10" aria-label="Product preview">
          <LandingPreview />
        </section>

        <section className="mx-auto mt-20 w-full max-w-[64rem] px-6 sm:mt-28 lg:px-10" aria-labelledby="how">
          <h2 id="how" className="t-title max-w-[20ch]">
            From inbox to clarity in three steps.
          </h2>
          <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {STEPS.map(([title, detail], i) => (
              <li key={title}>
                <p className="tnum text-[0.9375rem] font-medium text-ink-3">{i + 1}</p>
                <h3 className="t-heading mt-2">{title}</h3>
                <p className="mt-2 text-ink-2">{detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto mt-20 w-full max-w-[64rem] px-6 sm:mt-28 lg:px-10" aria-labelledby="trust">
          <div className="grid gap-10 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
            <h2 id="trust" className="t-title max-w-[14ch]">
              Built to be trusted with your inbox.
            </h2>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {TRUST.map(([term, detail]) => (
                <div key={term}>
                  <dt className="font-medium tracking-tight">{term}</dt>
                  <dd className="mt-1.5 text-ink-2">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto mt-20 w-full max-w-[64rem] px-6 pb-24 sm:mt-28 sm:pb-28 lg:px-10" aria-labelledby="final">
          <div className="panel p-8 sm:p-12">
            <h2 id="final" className="t-display max-w-[16ch]">
              See where you stand.
            </h2>
            <p className="t-lead mt-4 max-w-[40ch] text-ink-2">The first read takes a minute or two. After that, every morning starts with what needs you.</p>
            <div className="mt-8">{cta}</div>
          </div>
        </section>
      </main>
    </div>
  );
}
