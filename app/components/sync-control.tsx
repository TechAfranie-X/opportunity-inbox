"use client";

import { useActionState, useEffect, useRef } from "react";
import { syncAction, type SyncState } from "@/app/actions";

/**
 * Re-reads Gmail. Rendered as quiet text; while it works, a hairline sweeps across the page top
 * so the work is visible without a spinner. `autoStart` runs it once on first visit.
 */
export function SyncControl({
  autoStart = false,
  label = "Refresh",
  className = "link-quiet",
}: {
  autoStart?: boolean;
  label?: string;
  className?: string;
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
        <div className="fixed inset-x-0 top-0 z-40" role="progressbar" aria-label="Reading your recruiting emails">
          <div className="sweep" />
        </div>
      ) : null}
      <form ref={formRef} action={run} className="inline-flex flex-wrap items-center gap-x-3">
        <button type="submit" disabled={pending} className={className}>
          {pending ? "Reading your inbox…" : label}
        </button>
        {state.status === "error" ? (
          <span className="t-meta text-signal" role="alert">
            {state.message}
          </span>
        ) : null}
      </form>
      {state.status === "error" && state.reconnect ? (
        <form action="/api/gmail/connect" method="post" className="inline">
          <button type="submit" className="btn-primary">
            Reconnect Gmail
          </button>
        </form>
      ) : null}
    </>
  );
}
