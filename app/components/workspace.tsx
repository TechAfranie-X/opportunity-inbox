"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { CommandPalette } from "@/app/components/command-palette";
import { Inspector } from "@/app/components/inspector";
import type { Opportunity } from "@/lib/recruiting/types";

type WorkspaceContext = {
  opportunities: Opportunity[];
  now: Date;
  basePath: string;
  editable: boolean;
  selectedKey: string | null;
  open: (key: string) => void;
  close: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

const Ctx = createContext<WorkspaceContext | null>(null);

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/**
 * Holds the one piece of shared UI state in the product: which opportunity (if any) is open in the
 * inspector, plus the command palette. The selection mirrors `?o=` in the URL so it survives reloads
 * and can be shared, without a server round trip when it changes.
 */
const URL_EVENT = "oi:url";
const subscribeUrl = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  window.addEventListener(URL_EVENT, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(URL_EVENT, notify);
  };
};
const readSelection = () => new URL(window.location.href).searchParams.get("o");
const noSelection = () => null;

function writeSelection(key: string | null) {
  const url = new URL(window.location.href);
  if (key) url.searchParams.set("o", key);
  else url.searchParams.delete("o");
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(URL_EVENT));
}

/**
 * Holds the one piece of shared UI state in the product: which opportunity (if any) is open in the
 * inspector, plus the command palette. The selection lives in `?o=` in the URL, so it survives reloads
 * and can be shared, and changing it needs no server round trip.
 */
export function WorkspaceProvider({
  opportunities,
  now,
  basePath,
  editable,
  children,
}: {
  opportunities: Opportunity[];
  now: Date;
  basePath: string;
  editable: boolean;
  children: ReactNode;
}) {
  const param = useSyncExternalStore(subscribeUrl, readSelection, noSelection);
  const selectedKey = param && opportunities.some((o) => o.key === param) ? param : null;
  const [paletteOpen, setPaletteOpen] = useState(false);

  const open = useCallback((key: string) => writeSelection(key), []);
  const close = useCallback(() => writeSelection(null), []);

  useEffect(() => {
    document.documentElement.dataset.inspector = selectedKey ? "open" : "closed";
  }, [selectedKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape" && !paletteOpen && selectedKey) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, selectedKey, close]);

  const value = useMemo(
    () => ({ opportunities, now, basePath, editable, selectedKey, open, close, paletteOpen, setPaletteOpen }),
    [opportunities, now, basePath, editable, selectedKey, open, close, paletteOpen],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Inspector />
      <CommandPalette />
    </Ctx.Provider>
  );
}

/**
 * A link to an opportunity that opens the inspector in place. It is a real anchor to the full page,
 * so middle-click, copy-link and no-JS all still work.
 */
export function OpenOpportunity({
  opportunityKey,
  children,
  ...rest
}: { opportunityKey: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { open, basePath } = useWorkspace();
  return (
    <a
      {...rest}
      href={`${basePath}/${encodeURIComponent(opportunityKey)}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        open(opportunityKey);
      }}
    >
      {children}
    </a>
  );
}
