"use client";

import { useId, useState, type ReactNode } from "react";

/** Reveals more content in place; the height animates and the content stays in the DOM. */
export function Disclose({
  summary,
  openSummary,
  children,
  className = "",
}: {
  summary: string;
  openSummary?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        className="link-quiet inline-flex items-center gap-1.5"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-200" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          <path d="M3 1.5 6 4.5 3 7.5" />
        </svg>
        {open ? (openSummary ?? summary) : summary}
      </button>
      <div id={id} className="disclose" data-open={open} aria-hidden={!open} inert={!open}>
        <div>{children}</div>
      </div>
    </div>
  );
}
