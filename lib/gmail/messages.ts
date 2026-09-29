import "server-only";

import { getGmailRefreshToken } from "@/lib/gmail/credentials";
import {
  GmailAccessError,
  classifyGmailApiFailure,
  refreshGmailAccessToken,
} from "@/lib/gmail/oauth";

export type GmailInboxMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
};

export type InboxMessagesResult =
  | { ok: true; messages: GmailInboxMessage[] }
  | { ok: false; reason: "reconnect_required" | "temporary_error" };

type GmailMessageListResponse = {
  messages?: Array<{
    id?: string;
    threadId?: string;
  }>;
};

type GmailMessageMetadataResponse = {
  id?: string;
  threadId?: string;
  payload?: {
    headers?: Array<{
      name?: string;
      value?: string;
    }>;
  };
};

async function gmailGetJson<T>(accessToken: string, url: URL): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new GmailAccessError("temporary_error");
  }

  if (!response.ok) {
    throw new GmailAccessError(classifyGmailApiFailure(response.status));
  }

  return (await response.json()) as T;
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
) {
  const match = headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return match?.value?.trim() ?? "";
}

async function listInboxMessageRefs(accessToken: string) {
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set("maxResults", "10");
  url.searchParams.append("labelIds", "INBOX");

  const payload = await gmailGetJson<GmailMessageListResponse>(
    accessToken,
    url,
  );

  return (payload.messages ?? []).flatMap((message) => {
    if (!message.id || !message.threadId) {
      return [];
    }
    return [{ id: message.id, threadId: message.threadId }];
  });
}

async function getInboxMessageMetadata(accessToken: string, id: string) {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
  );
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Subject");
  url.searchParams.append("metadataHeaders", "Date");

  const payload = await gmailGetJson<GmailMessageMetadataResponse>(
    accessToken,
    url,
  );

  if (!payload.id || !payload.threadId) {
    throw new GmailAccessError("temporary_error");
  }

  const headers = payload.payload?.headers;
  return {
    id: payload.id,
    threadId: payload.threadId,
    from: headerValue(headers, "From"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
  } satisfies GmailInboxMessage;
}

export async function listRecentInboxMessages(
  userGoogleSub: string,
): Promise<InboxMessagesResult> {
  try {
    const refreshToken = await getGmailRefreshToken(userGoogleSub);
    if (!refreshToken) {
      return { ok: false, reason: "reconnect_required" };
    }

    const accessToken = await refreshGmailAccessToken(refreshToken);
    const refs = await listInboxMessageRefs(accessToken);
    const messages: GmailInboxMessage[] = [];

    for (const ref of refs) {
      messages.push(await getInboxMessageMetadata(accessToken, ref.id));
    }

    return { ok: true, messages };
  } catch (error) {
    if (error instanceof GmailAccessError) {
      return { ok: false, reason: error.reason };
    }
    return { ok: false, reason: "temporary_error" };
  }
}
