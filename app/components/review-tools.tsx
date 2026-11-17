"use client";

import { useId, useState, type ReactNode } from "react";
import { confirmEventAction, ignoreEventAction } from "@/app/actions";

/**
 * The three things a person can do with an item we are unsure about, and nothing else until asked:
 * say it is right, say it is not recruiting, or open the form to fix it. The form is progressive disclosure, so a list of
 * a dozen items reads as a dozen sentences instead of a dozen forms.
 */
export function ReviewTools({ eventId, confirmLabel = "Looks right", children }: { eventId: string; confirmLabel?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <form action={confirmEventAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <button type="submit" className="btn-soft">
            {confirmLabel}
          </button>
        </form>
        <button type="button" className="link-quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Fix details"}
        </button>
        <form action={ignoreEventAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <button type="submit" className="link-quiet">
            Not recruiting, hide it
          </button>
        </form>
      </div>
      <div id={id} className="disclose" data-open={open} aria-hidden={!open} inert={!open}>
        <div>{children}</div>
      </div>
    </div>
  );
}
