import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="flex min-h-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <p className="text-sm font-semibold tracking-tight">
          Opportunity Inbox
        </p>
        {user ? (
          <div className="flex items-center gap-3">
            <div className="text-right">
              {user.name ? (
                <p className="text-sm font-medium">{user.name}</p>
              ) : null}
              {user.email ? (
                <p className="text-xs text-zinc-500">{user.email}</p>
              ) : null}
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="appearance-none rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Sign Out
              </button>
            </form>
          </div>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="appearance-none rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Sign In
            </button>
          </form>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Your career opportunities are already in your inbox.
          </h1>
          <p className="mt-5 text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Opportunity Inbox turns recruiting emails, assessments, interviews,
            deadlines, scholarships, and similar opportunities into one
            actionable dashboard.
          </p>
          <div className="mt-8">
            <button
              type="button"
              className="appearance-none rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Connect Gmail
            </button>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-500">
              Read-only access. You stay in control of your inbox.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
