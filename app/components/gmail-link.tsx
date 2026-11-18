"use client";

import { type AnchorHTMLAttributes, type ReactNode } from "react";
import { useWorkspace } from "@/app/components/workspace";
import { gmailThreadUrl } from "@/lib/recruiting/format";

/** The Gmail URL for a conversation in the connected account (see gmailThreadUrl). Client-side so every surface gets the account from one place. */
export function useGmailUrl() {
  const { gmailAccount } = useWorkspace();
  return (threadId: string) => gmailThreadUrl(threadId, gmailAccount);
}

export function GmailLink({ threadId, children, ...rest }: { threadId: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel">) {
  const url = useGmailUrl();
  return (
    <a {...rest} href={url(threadId)} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
