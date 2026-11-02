"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const OPTIONS: Theme[] = ["system", "light", "dark"];
const KEY = "oi-theme";
const EVENT = "oi:theme";

const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  return () => window.removeEventListener(EVENT, notify);
};
/** The html element is the source of truth (the inline script set it before first paint). */
const read = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "system" ? t : "light";
};
const readServer = (): Theme => "light";

function applyTheme(next: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-fade");
  root.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage can be unavailable; the choice still applies for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
  window.setTimeout(() => root.classList.remove("theme-fade"), 320);
}

/** Appearance: System / Light / Dark. Persisted; the change crossfades. */
export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, read, readServer);
  return (
    <div className="px-2 pb-1 pt-1.5">
      <p className="t-meta mb-1.5 text-ink-3" id="appearance-label">
        Appearance
      </p>
      <div className="segmented" role="radiogroup" aria-labelledby="appearance-label">
        <span className="segmented-thumb" style={{ transform: `translateX(${OPTIONS.indexOf(theme) * 100}%)` }} aria-hidden />
        {OPTIONS.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={theme === option} onClick={() => applyTheme(option)}>
            {option === "system" ? "System" : option === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
    </div>
  );
}
