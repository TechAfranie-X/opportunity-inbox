import "server-only";

import {
  GmailAccessError,
  classifyGmailApiFailure,
} from "@/lib/gmail/oauth";

type GmailThreadResponse = {
  messages?: Array<{
    id?: string;
    payload?: {
      headers?: Array<{
        name?: string;
        value?: string;
      }>;
    };
  }>;
};

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
) {
  const match = headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return match?.value?.trim() ?? "";
}

export async function fetchThreadSubjects(
  accessToken: string,
  threadId: string,
): Promise<string[]> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
  );
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "Subject");

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

  const payload = (await response.json()) as GmailThreadResponse;
  return (payload.messages ?? []).flatMap((message) => {
    const subject = headerValue(message.payload?.headers, "Subject");
    return subject ? [subject] : [];
  });
}

export async function fetchThreadSubjectsById(
  accessToken: string,
  threadIds: string[],
  batchSize = 4,
) {
  const subjectsByThread = new Map<string, string[]>();
  const uniqueIds = [...new Set(threadIds)];

  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    const batch = uniqueIds.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map(async (threadId) => {
        try {
          return [threadId, await fetchThreadSubjects(accessToken, threadId)] as const;
        } catch {
          return [threadId, [] as string[]] as const;
        }
      }),
    );

    for (const [threadId, subjects] of results) {
      subjectsByThread.set(threadId, subjects);
    }
  }

  return subjectsByThread;
}
