"use client";

import { useWorkspace } from "@/app/components/workspace";

export function SearchButton() {
  const { setPaletteOpen } = useWorkspace();
  return (
    <>
      <button type="button" onClick={() => setPaletteOpen(true)} className="search-pill" aria-label="Search">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <circle cx="5.5" cy="5.5" r="4" />
          <path d="m8.6 8.6 3 3" />
        </svg>
        <span className="pr-6">Search</span>
        <kbd>⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search"
        className="grid h-9 w-9 place-items-center rounded-full text-ink-2 hover:bg-wash md:hidden"
      >
        <svg width="15" height="15" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <circle cx="5.5" cy="5.5" r="4" />
          <path d="m8.6 8.6 3 3" />
        </svg>
      </button>
    </>
  );
}
