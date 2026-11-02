"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/app/components/workspace";
import { STAGE_LABEL } from "@/lib/recruiting/format";

type Entry = { id: string; title: string; hint: string; run: () => void };

/** ⌘K: jump to a page or open any opportunity. A control surface, so it carries the material. */
export function CommandPalette() {
  const { paletteOpen } = useWorkspace();
  // Mounted only while open, so every opening starts with an empty query.
  return paletteOpen ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const { opportunities, basePath, setPaletteOpen, open } = useWorkspace();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const demo = basePath === "/demo";

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => {
      setPaletteOpen(false);
      router.push(href);
    };
    const pages: Entry[] = [
      { id: "p-today", title: "Today", hint: "Page", run: go(demo ? "/demo" : "/today") },
      { id: "p-pipeline", title: "Pipeline", hint: "Page", run: go(demo ? "/demo/pipeline" : "/pipeline") },
      { id: "p-activity", title: "Activity", hint: "Page", run: go(demo ? "/demo/activity" : "/activity") },
    ];
    const opps: Entry[] = opportunities.map((o) => ({
      id: o.key,
      title: o.company,
      hint: `${o.role ?? "No role"} · ${o.status === "closed" ? "Closed" : STAGE_LABEL[o.stage]}`,
      run: () => {
        setPaletteOpen(false);
        open(o.key);
      },
    }));
    const q = query.trim().toLowerCase();
    if (!q) return [...pages, ...opps.slice(0, 7)];
    return [...pages, ...opps].filter((e) => `${e.title} ${e.hint}`.toLowerCase().includes(q)).slice(0, 9);
  }, [opportunities, query, demo, router, setPaletteOpen, open]);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-start justify-items-center px-4 pt-[14vh]" onMouseDown={() => setPaletteOpen(false)}>
      <div
        role="dialog"
        aria-label="Search"
        aria-modal="true"
        className="glass-thick w-full max-w-[34rem] overflow-hidden rounded-[var(--r-lg)] border border-[var(--glass-line)] shadow-[var(--shadow-panel)]"
        style={{ animation: "pop-in var(--dur-2) var(--ease)" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setPaletteOpen(false);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, entries.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          }
          if (e.key === "Enter") entries[cursor]?.run();
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder="Search companies, roles, pages"
          aria-label="Search"
          className="w-full border-b border-line bg-transparent px-5 py-4 text-[1.0625rem] outline-none placeholder:text-ink-3"
        />
        <ul className="max-h-[22rem] overflow-y-auto p-2" role="listbox">
          {entries.length === 0 ? <li className="px-3 py-6 text-center text-sm text-ink-3">Nothing matches &ldquo;{query}&rdquo;.</li> : null}
          {entries.map((entry, i) => (
            <li key={entry.id} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseMove={() => setCursor(i)}
                onClick={entry.run}
                className={`flex w-full items-baseline justify-between gap-4 rounded-[var(--r-sm)] px-3 py-2 text-left transition-colors ${i === cursor ? "bg-wash" : ""}`}
              >
                <span className="font-medium tracking-tight">{entry.title}</span>
                <span className="t-meta truncate text-ink-3">{entry.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
