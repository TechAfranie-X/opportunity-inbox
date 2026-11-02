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
        className="link-quiet"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (openSummary ?? summary) : summary}
      </button>
      <div id={id} className="disclose" data-open={open} aria-hidden={!open} inert={!open}>
        <div>{children}</div>
      </div>
    </div>
  );
}
