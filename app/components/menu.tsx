"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small contextual menu. Secondary actions live here so that each row can show one obvious
 * primary action and stay quiet otherwise. Closes on outside click and Escape; arrow keys move focus.
 */
export function Menu({
  label,
  trigger,
  align = "right",
  children,
  onOpenChange,
}: {
  label: string;
  /** Custom trigger content; defaults to a three-dot glyph. */
  trigger?: ReactNode;
  /** Which edge of the trigger the menu hangs from. */
  align?: "left" | "right";
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const set = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    root.current?.closest(".row")?.setAttribute("data-open", String(next));
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) set(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        set(false);
        root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(root.current?.querySelectorAll<HTMLElement>(".menu-item") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative inline-block" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => set(!open)}
        className="grid h-8 min-w-8 place-items-center rounded-full px-1 text-ink-2 transition-colors hover:bg-wash hover:text-ink"
      >
        {trigger ?? (
          <svg width="16" height="4" viewBox="0 0 16 4" fill="currentColor" aria-hidden>
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="8" cy="2" r="1.5" />
            <circle cx="14" cy="2" r="1.5" />
          </svg>
        )}
      </button>
      {open ? (
        <div className="menu glass-thick" data-align={align} role="menu" onClick={() => window.setTimeout(() => set(false), 180)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
