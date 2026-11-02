"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Secondary controls for one timeline entry. "Open email" and "Correct" stay out of sight until the
 * entry is hovered or focused (always visible on touch), and the correction form opens in place.
 */
export function EventTools({ emailHref, children }: { emailHref?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div
        className={`flex items-baseline gap-4 max-sm:col-start-2 max-sm:mt-1 sm:absolute sm:right-0 sm:top-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      >
        {emailHref ? (
          <a className="link-quiet t-meta" href={emailHref} target="_blank" rel="noreferrer">
            Open email
          </a>
        ) : null}
        <button type="button" className="link-quiet t-meta" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Correct"}
        </button>
      </div>
      <div id={id} className="disclose col-start-2" data-open={open} aria-hidden={!open} inert={!open}>
        <div>{children}</div>
      </div>
    </>
  );
}
