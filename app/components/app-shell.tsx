import Link from "next/link";
import { type ReactNode } from "react";
import { signOut } from "@/auth";
import { deleteMyDataAction, disconnectGmailAction } from "@/app/actions";
import { ConfirmForm } from "@/app/components/confirm-form";
import { Menu } from "@/app/components/menu";

const NAV = [
  { id: "today", href: "/today", label: "Today" },
  { id: "pipeline", href: "/pipeline", label: "Pipeline" },
] as const;

const DEMO_NAV = [
  { id: "today", href: "/demo", label: "Today" },
  { id: "pipeline", href: "/demo/pipeline", label: "Pipeline" },
] as const;

export function firstName(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "";
  const first = source.split(/\s+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

export function AppShell({
  active,
  demo = false,
  user,
  children,
}: {
  active?: "today" | "pipeline";
  demo?: boolean;
  user?: { name?: string | null; email?: string | null };
  children: ReactNode;
}) {
  const nav = demo ? DEMO_NAV : NAV;
  return (
    <div className="flex min-h-full flex-col">
      {demo ? (
        <p className="t-meta border-b border-line px-6 py-2 text-center text-ink-2">
          Sample data, not your inbox.{" "}
          <Link className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink" href="/">
            Connect Gmail
          </Link>{" "}
          to see your own.
        </p>
      ) : null}
      <header className="mx-auto flex w-full max-w-[42rem] items-center justify-between px-6 pt-6">
        <div className="flex items-baseline gap-7">
          <Link href={demo ? "/demo" : "/today"} className="text-[0.9375rem] font-semibold tracking-tight">
            Opportunity Inbox
          </Link>
          <nav className="flex gap-5 text-sm" aria-label="Primary">
            {nav.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={item.id === active ? "page" : undefined}
                className={`transition-colors ${item.id === active ? "text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        {user && !demo ? (
          <Menu
            label="Account"
            trigger={
              <span className="flex items-center gap-1.5 px-2 text-sm text-ink-2">
                {firstName(user.name, user.email)}
                <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
                  <path d="m1 1 3.5 3.5L8 1" />
                </svg>
              </span>
            }
          >
            {user.email ? <p className="t-meta px-2.5 pb-1 pt-1.5 text-ink-3">{user.email}</p> : null}
            <div className="menu-sep" />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="menu-item">
                Sign out
              </button>
            </form>
            <div className="menu-sep" />
            <p className="t-meta px-2.5 pb-1 pt-0.5 text-ink-3">We keep company, role, stage and dates. Never message text.</p>
            <ConfirmForm action={deleteMyDataAction} label="Delete what we derived" confirmLabel="Click again to delete" />
            <ConfirmForm action={disconnectGmailAction} label="Disconnect Gmail and delete all" confirmLabel="Click again to disconnect" />
          </Menu>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-[42rem] flex-1 px-6 pb-28 pt-16">{children}</main>
    </div>
  );
}
