import Link from "next/link";
import { type ReactNode } from "react";

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/pipeline", label: "Pipeline" },
] as const;

const DEMO_NAV = [
  { href: "/demo", label: "Today" },
  { href: "/demo/pipeline", label: "Pipeline" },
] as const;

export function AppShell({
  active,
  demo = false,
  userLabel,
  banner,
  children,
}: {
  active?: "today" | "pipeline";
  demo?: boolean;
  userLabel?: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-background font-sans text-foreground">
      {demo ? (
        <p className="bg-amber-50 px-6 py-2 text-center text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Sample data — this is a demo, not your inbox. <Link className="underline" href="/">Connect Gmail</Link> to see your own.
        </p>
      ) : null}
      {banner}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href={demo ? "/demo" : "/"} className="text-sm font-semibold tracking-tight">Opportunity Inbox</Link>
            <nav className="flex gap-4 text-sm">
              {(demo ? DEMO_NAV : NAV).map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={(i === 0 ? "today" : "pipeline") === active ? "font-medium" : "text-zinc-500 hover:text-foreground"}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          {userLabel ? <p className="text-xs text-zinc-500">{userLabel}</p> : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
