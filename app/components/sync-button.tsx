"use client";

import { useActionState, useEffect, useRef } from "react";
import { syncAction, type SyncState } from "@/app/actions";

/**
 * Re-scan Gmail. With `autoStart` it kicks off once on mount — used right after
 * connecting so the first visit shows value without another click.
 */
export function SyncButton({
  autoStart = false,
  label = "Refresh from Gmail",
}: {
  autoStart?: boolean;
  label?: string;
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
    <form ref={formRef} action={run} className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="appearance-none rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "Reading your recruiting emails…" : label}
      </button>
      {state.status === "error" ? <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p> : null}
    </form>
  );
}
