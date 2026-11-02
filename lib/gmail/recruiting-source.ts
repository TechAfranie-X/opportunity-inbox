import "server-only";

import { extractBodyText, type GmailPayloadPart } from "@/lib/gmail/body";
import {
  GmailAccessError,
  classifyGmailApiFailure,
} from "@/lib/gmail/oauth";
import type { RecruitingEmail } from "@/lib/recruiting/types";

/**
 * Gmail search that over-fetches recruiting-looking mail. It only has to be a
 * cheap first filter — the extractor decides what is actually recruiting.
 * Scope stays gmail.readonly; nothing is modified in the mailbox.
 */
const RECRUITING_QUERY = [
  "newer_than:365d",
  "-in:spam -in:trash -in:sent -in:drafts",
  "(",
  'subject:(application OR applying OR applied OR interview OR assessment OR "coding challenge" OR "online assessment" OR offer OR recruiter OR candidacy OR "next steps" OR "your candidacy" OR internship OR "phone screen" OR "take-home")',
  "OR from:(greenhouse.io OR greenhouse-mail.io OR lever.co OR myworkday.com OR ashbyhq.com OR icims.com OR smartrecruiters.com OR workable.com OR jobvite.com OR hackerrank.com OR codesignal.com OR codility.com OR hirevue.com OR karat.com)",
  ")",
].join(" ");

type Header = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayloadPart & { headers?: Header[] };
};

function header(headers: Header[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

const MAX_ATTEMPTS = 7;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET with retry. Gmail throttles per-user bursts with 429 or
 * 403 rateLimitExceeded; those are transient, so back off and retry instead of
 * failing the whole sync. Only status/reason are ever logged, never content.
 */
async function gmailGet<T>(accessToken: string, url: URL): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      if (attempt >= MAX_ATTEMPTS) throw new GmailAccessError("temporary_error");
      await sleep(500 * attempt);
      continue;
    }
    if (response.ok) return (await response.json()) as T;

    const body = (await response.json().catch(() => ({}))) as { error?: { errors?: Array<{ reason?: string }> } };
    const reason = body.error?.errors?.[0]?.reason ?? "unknown";
    const throttled = response.status === 429 || (response.status === 403 && /ratelimit/i.test(reason)) || response.status >= 500;
    if (throttled && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(15_000, 500 * 2 ** attempt);
      await sleep(wait + Math.random() * 300);
      continue;
    }
    console.error(`gmail request failed: status=${response.status} reason=${reason}`);
    throw new GmailAccessError(classifyGmailApiFailure(response.status));
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

function toEmail(message: GmailMessage, includeBody: boolean): RecruitingEmail | null {
  if (!message.id || !message.threadId) return null;
  const headers = message.payload?.headers;
  const labels = message.labelIds ?? [];
  const received = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    from: header(headers, "From"),
    subject: header(headers, "Subject"),
    receivedAt: Number.isFinite(received) && received > 0 ? new Date(received) : new Date(header(headers, "Date")),
    outbound: labels.includes("SENT"),
    // Transient: only used by the extractor, never persisted or logged.
    bodyText: includeBody ? extractBodyText(message.payload) : "",
  };
}

async function listIds(accessToken: string, max: number) {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", RECRUITING_QUERY);
    url.searchParams.set("maxResults", String(Math.min(100, max - ids.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await gmailGet<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(accessToken, url);
    ids.push(...(page.messages ?? []).flatMap((m) => (m.id ? [m.id] : [])));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

export type FetchedMail = { emails: RecruitingEmail[]; scanned: number };

/** Inbound recruiting-looking mail, with bodies (transient). */
export async function fetchInboundCandidates(accessToken: string, max = 200): Promise<FetchedMail> {
  const ids = await listIds(accessToken, max);
  const messages = await inBatches(ids, 2, (id) =>
    gmailGet<GmailMessage>(accessToken, new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`)),
  );
  const emails = messages.flatMap((m) => {
    const email = toEmail(m, true);
    return email && !email.outbound ? [email] : [];
  });
  return { emails, scanned: ids.length };
}

/**
 * The user's own messages in the given threads. Metadata only (no bodies):
 * we just need to know *that* they replied, not what they said.
 */
export async function fetchOutboundInThreads(accessToken: string, threadIds: string[], max = 80): Promise<RecruitingEmail[]> {
  const unique = [...new Set(threadIds)].slice(0, max);
  const threads = await inBatches(unique, 2, async (threadId) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`);
    url.searchParams.set("format", "metadata");
    for (const h of ["From", "Subject", "Date"]) url.searchParams.append("metadataHeaders", h);
    try {
      return await gmailGet<{ messages?: GmailMessage[] }>(accessToken, url);
    } catch (error) {
      if (error instanceof GmailAccessError && error.reason === "reconnect_required") throw error;
      return { messages: [] };
    }
  });
  return threads.flatMap((t) =>
    (t.messages ?? []).flatMap((m) => {
      const email = toEmail(m, false);
      return email?.outbound ? [email] : [];
    }),
  );
}
