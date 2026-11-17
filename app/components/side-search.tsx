"use client";

import { IconSearch } from "@/app/components/icons";
import { useWorkspace } from "@/app/components/workspace";

/** Search in the sidebar: opens the same palette as ⌘K. */
export function SideSearch() {
  const { setPaletteOpen } = useWorkspace();
  return (
    <button type="button" className="side-link w-full text-left" onClick={() => setPaletteOpen(true)}>
      <IconSearch />
      <span>Search</span>
    </button>
  );
}
