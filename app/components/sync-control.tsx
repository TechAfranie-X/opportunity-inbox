"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { syncAction, type SyncState } from "@/app/actions";

/** Auto-sync at most once per this long per browser, so a failing or slow sync can never loop across page loads. */
const AUTO_THROTTLE_MS = 30 * 60_000;
/** A request reads for a bounded time; while mail remains, continue, but never more than this many times in a row. */
const MAX_CONTINUES = 8;

const read = (key: string) => { try { return Number(window.localStorage.getItem(key) ?? 0); } catch { return 0; } };
const write = (key: string, value: number) => { try { window.localStorage.setItem(key, String(value)); } catch { /* storage unavailable: no throttle, still bounded by the ref */ } };

/**
 * Re-reads Gmail from the navigation bar. While it works, a line of the accent travels along the
 * bar's lower edge, so progress is visible without a spinner.
 *  - "first": the very first read after connecting runs immediately.
 *  - "stale": the data is old; refresh once, throttled per browser.
 *  - If a request ends with mail still unread (a long first read), it continues by itself, a bounded number of times.
 */
export function SyncControl({
  autoStart = false,
  updated,
}: {
  autoStart?: false | "first" | "stale";
  /** Preformatted "12:30 AM" (formatted on the server so it matches hydration). */
  updated?: string;
}) {
  const [state, run, pending] = useActionState<SyncState>(syncAction, { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);
  const continues = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!autoStart || started.current) return;
    if (autoStart === "stale" && Date.now() - read("oi:auto-sync") < AUTO_THROTTLE_MS) return;
    started.current = true;
    write("oi:auto-sync", Date.now());
    formRef.current?.requestSubmit();
  }, [autoStart]);

  const remaining = state.status === "idle" ? state.remaining ?? 0 : 0;
  useEffect(() => {
    if (pending || state.status !== "idle" || remaining <= 0) return;
    if (continues.current >= MAX_CONTINUES) { setGaveUp(true); return; }
    continues.current += 1;
    formRef.current?.requestSubmit();
  }, [pending, state, remaining]);

  // Derived from what the last request reported, never from the ref, so rendering stays pure.
  const continuing = pending && remaining > 0;
  const more = !pending && remaining > 0 && gaveUp;

  return (
    <>
      {pending ? (
        <div className="fixed inset-x-0 z-[41]" style={{ top: "calc(var(--nav-h) - 1px)" }} role="progressbar" aria-label="Reading your recruiting emails">
          <div className="sweep" />
        </div>
      ) : null}
      <form ref={formRef} action={run} className="flex items-center gap-2.5">
        <span className="t-meta tnum hidden text-ink-3 lg:inline" aria-live="polite">
          {pending ? (continuing ? "Reading older mail…" : "Reading your inbox…") : state.status === "error" ? <span className="text-signal">{state.message}</span> : more ? `Older mail is still unread · Refresh to continue` : updated ? `Updated ${updated}` : ""}
        </span>
        <button type="submit" disabled={pending} className="link-quiet t-meta disabled:opacity-50" onClick={() => { continues.current = 0; setGaveUp(false); }}>
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
