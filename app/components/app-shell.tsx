import Link from "next/link";
import { type ReactNode } from "react";
import { signOut } from "@/auth";
import { deleteMyDataAction, disconnectGmailAction } from "@/app/actions";
import { Mark } from "@/app/components/brand";
import { ConfirmForm } from "@/app/components/confirm-form";
import { Menu } from "@/app/components/menu";
import { SearchButton } from "@/app/components/search-button";
import { SyncControl } from "@/app/components/sync-control";
import { ThemeControl } from "@/app/components/theme-control";
import { WorkspaceProvider } from "@/app/components/workspace";
import { attentionCount, buildReviewQueue } from "@/lib/recruiting/review";
import type { EffectiveEvent, Opportunity } from "@/lib/recruiting/types";

type NavId = "today" | "pipeline" | "activity" | "review";

/**
 * Two destinations, not four. Today is the work; Pipeline is the state of everything. Activity is reached from Today ("all
 * activity") and from search; Check is a status in the navigation that appears only when there is something to check.
 */
const NAV: Array<{ id: NavId; label: string; href: string; demoHref: string }> = [
  { id: "today", label: "Today", href: "/today", demoHref: "/demo" },
  { id: "pipeline", label: "Pipeline", href: "/pipeline", demoHref: "/demo/pipeline" },
];

export function firstName(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "";
  const first = source.split(/\s+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

/** The persistent frame: a solid, quiet navigation bar, and a plain tab bar on narrow screens. */
export function AppShell({
  active,
  demo = false,
  user,
  updated,
  autoSync = false as false | "first" | "stale",
  opportunities,
  possible = [],
  now,
  width = "mid",
  children,
}: {
  active: NavId;
  demo?: boolean;
  user?: { name?: string | null; email?: string | null };
  /** Preformatted time of the last sync. */
  updated?: string;
  autoSync?: false | "first" | "stale";
  opportunities: Opportunity[];
  /** Messages that might be recruiting but are not in the pipeline (they only count toward "Check"). */
  possible?: EffectiveEvent[];
  now: Date;
  /** One centred column per kind of page: reading (lists to work through), mid (structure and history), wide (Today, which has a side column). */
  width?: "reading" | "mid" | "wide";
  children: ReactNode;
}) {
  const reviewCount = demo ? 0 : attentionCount(buildReviewQueue(opportunities, undefined, possible));
  const hrefOf = (item: (typeof NAV)[number]) => (demo ? item.demoHref : item.href);
  const initial = firstName(user?.name, user?.email).charAt(0);

  return (
    <WorkspaceProvider opportunities={opportunities} now={now} basePath={demo ? "/demo" : "/opportunities"} editable={!demo}>
      <header className="nav">
        <div className="mx-auto flex h-full w-full max-w-[75rem] items-center justify-between px-6 lg:px-10">
          <div className="flex items-center gap-8">
            <Link href={demo ? "/demo" : "/today"} className="flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-tight">
              <Mark />
              <span className="max-sm:hidden">Opportunity Inbox</span>
            </Link>
            <nav className="flex items-center gap-6 max-md:hidden" aria-label="Primary">
              {NAV.map((item) => (
                <Link key={item.id} href={hrefOf(item)} className="nav-link" aria-current={item.id === active ? "page" : undefined}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {reviewCount > 0 ? (
              <Link href="/review" className="status-link" aria-current={active === "review" ? "page" : undefined}>
                <span className="status-dot" aria-hidden />
                <span>
                  <span className="tnum">{reviewCount}</span> to check
                </span>
              </Link>
            ) : null}
            {!demo ? <SyncControl autoStart={autoSync} updated={updated} /> : null}
            <SearchButton />
            {user && !demo ? (
              <Menu
                label="Account"
                trigger={<span className="grid h-8 w-8 place-items-center rounded-md bg-tint text-sm font-medium text-ink">{initial}</span>}
              >
                {user.email ? <p className="t-meta px-2.5 pb-1 pt-1.5 text-ink-3">{user.email}</p> : null}
                <div className="menu-sep" />
                <ThemeControl />
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
            ) : demo ? (
              <Menu label="Appearance" trigger={<span className="px-2 text-sm text-ink-2">Appearance</span>}>
                <ThemeControl />
              </Menu>
            ) : null}
          </div>
        </div>
      </header>

      <div className="workspace flex-1" style={{ paddingTop: "calc(var(--nav-h) + 2.75rem)", paddingBottom: "7rem" }}>
        {demo ? (
          <p className="t-meta mx-auto -mt-4 mb-8 w-full max-w-[75rem] px-6 text-ink-2 lg:px-10">
            Sample data, not your inbox.{" "}
            <Link className="link" href="/">
              Connect Gmail
            </Link>{" "}
            to see your own.
          </p>
        ) : null}
        <main className="mx-auto w-full max-w-[75rem] px-6 lg:px-10">
          <div className={`mx-auto w-full ${width === "reading" ? "max-w-[46rem]" : width === "mid" ? "max-w-[58rem]" : "max-w-[68rem]"}`}>{children}</div>
        </main>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {NAV.map((item) => (
          <Link key={item.id} href={hrefOf(item)} aria-current={item.id === active ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
        {reviewCount > 0 ? (
          <Link href="/review" aria-current={active === "review" ? "page" : undefined}>
            Check <span className="tnum">{reviewCount}</span>
          </Link>
        ) : null}
      </nav>
    </WorkspaceProvider>
  );
}
