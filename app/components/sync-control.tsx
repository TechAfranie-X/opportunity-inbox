"use client";

import { useActionState, useEffect, useRef } from "react";
import { syncAction, type SyncState } from "@/app/actions";

/**
 * Re-reads Gmail from the navigation bar. While it works, a line of the accent travels along the
 * bar's lower edge, so progress is visible without a spinner. `autoStart` runs it once on first visit.
 */
export function SyncControl({
  autoStart = false,
  updated,
}: {
  autoStart?: boolean;
  /** Preformatted "12:30 AM" (formatted on the server so it matches hydration). */
  updated?: string;
}) {
  const [state, run, pending] = useActionState<SyncState>(syncAction, { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      formRef.current?.requestSubmit();
    }
  }, [autoStart]);

  return (
    <>
      {pending ? (
        <div className="fixed inset-x-0 z-[41]" style={{ top: "calc(var(--nav-h) - 1px)" }} role="progressbar" aria-label="Reading your recruiting emails">
          <div className="sweep" />
        </div>
      ) : null}
      <form ref={formRef} action={run} className="flex items-center gap-2.5">
        <span className="t-meta tnum hidden text-ink-3 lg:inline" aria-live="polite">
          {pending ? "Reading your inbox…" : state.status === "error" ? <span className="text-signal">{state.message}</span> : updated ? `Updated ${updated}` : ""}
        </span>
        <button type="submit" disabled={pending} className="link-quiet t-meta disabled:opacity-50">
          {pending ? "Syncing" : updated ? "Refresh" : "Read my inbox"}
        </button>
      </form>
      {state.status === "error" && state.reconnect ? (
        <form action="/api/gmail/connect" method="post" className="inline">
          <button type="submit" className="btn-primary !h-8 !px-3 text-xs">
            Reconnect Gmail
          </button>
        </form>
      ) : null}
    </>
  );
}
