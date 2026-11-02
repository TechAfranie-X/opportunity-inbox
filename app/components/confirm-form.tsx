"use client";

import { useRef, useState } from "react";

/** A destructive menu action that needs a second click within a few seconds. */
export function ConfirmForm({
  action,
  label,
  confirmLabel,
}: {
  action: () => void | Promise<void>;
  label: string;
  confirmLabel: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  return (
    <form action={action} onClick={(e) => e.stopPropagation()}>
      <button
        type={armed ? "submit" : "button"}
        className="menu-item"
        data-tone="danger"
        onClick={() => {
          if (armed) return;
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
        }}
      >
        {armed ? confirmLabel : label}
      </button>
    </form>
  );
}
