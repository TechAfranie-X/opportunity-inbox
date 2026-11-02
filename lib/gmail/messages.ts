import "server-only";

import {
  classifyOpportunityEmail,
  type ClassifyEmailInput,
  type OpportunityClassification,
} from "@/lib/opportunities/classify";
import { applyThreadContext } from "@/lib/opportunities/thread-context";
import { getGmailRefreshToken } from "@/lib/gmail/credentials";
import { type GmailInboxMessage } from "@/lib/gmail/inbox-message";
import {
  GmailAccessError,
  classifyGmailApiFailure,
  refreshGmailAccessToken,
} from "@/lib/gmail/oauth";
import { providerSignalsFromGmailLabels } from "@/lib/gmail/provider-signals";
import { fetchThreadSubjectsById } from "@/lib/gmail/thread-context";

export type { GmailInboxMessage } from "@/lib/gmail/inbox-message";

export const DEFAULT_INBOX_SAMPLE_SIZE = 50;
export const LARGE_INBOX_SAMPLE_SIZE = 100;

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
  labelIds?: string[];
  payload?: {
    headers?: Array<{
      name?: string;
      value?: string;
    }>;
  };
};

type ClassifiedInboxDraft = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  gmailLabels: string[];
  input: ClassifyEmailInput;
  classification: OpportunityClassification;
};

export function parseInboxSampleSize(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === String(LARGE_INBOX_SAMPLE_SIZE)) {
    return LARGE_INBOX_SAMPLE_SIZE;
  }
  return DEFAULT_INBOX_SAMPLE_SIZE;
}

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

async function listInboxMessageRefs(accessToken: string, maxResults: number) {
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set("maxResults", String(maxResults));
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

function toInboxMessage(draft: ClassifiedInboxDraft): GmailInboxMessage {
  return {
    id: draft.id,
    threadId: draft.threadId,
    from: draft.from,
    subject: draft.subject,
    date: draft.date,
    classificationLabel: draft.classification.label,
    intent: draft.classification.intent,
    pipelineScore: draft.classification.pipelineScore,
    opportunityScore: draft.classification.opportunityScore,
    noiseScore: draft.classification.noiseScore,
    bulkScore: draft.classification.bulkScore,
    directnessScore: draft.classification.directnessScore,
    careerScore: draft.classification.careerScore,
    matchedSignals: draft.classification.matchedSignals,
    gmailLabels: draft.gmailLabels,
    providerSignals: draft.input.providerSignals ?? providerSignalsFromGmailLabels(draft.gmailLabels),
  };
}

function classificationInputFromHeaders(
  headers: Array<{ name?: string; value?: string }> | undefined,
  labelIds: string[] | undefined,
): ClassifyEmailInput {
  return {
    subject: headerValue(headers, "Subject"),
    from: headerValue(headers, "From"),
    listUnsubscribe: headerValue(headers, "List-Unsubscribe"),
    listId: headerValue(headers, "List-Id"),
    autoSubmitted: headerValue(headers, "Auto-Submitted"),
    precedence: headerValue(headers, "Precedence"),
    providerSignals: providerSignalsFromGmailLabels(labelIds),
  };
}

async function getInboxMessageMetadata(
  accessToken: string,
  id: string,
): Promise<ClassifiedInboxDraft> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
  );
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Subject");
  url.searchParams.append("metadataHeaders", "Date");
  url.searchParams.append("metadataHeaders", "List-Unsubscribe");
  url.searchParams.append("metadataHeaders", "List-Id");
  url.searchParams.append("metadataHeaders", "Auto-Submitted");
  url.searchParams.append("metadataHeaders", "Precedence");

  const payload = await gmailGetJson<GmailMessageMetadataResponse>(
    accessToken,
    url,
  );

  if (!payload.id || !payload.threadId) {
    throw new GmailAccessError("temporary_error");
  }

  const headers = payload.payload?.headers;
  const input = classificationInputFromHeaders(headers, payload.labelIds);

  return {
    id: payload.id,
    threadId: payload.threadId,
    from: input.from,
    subject: input.subject,
    date: headerValue(headers, "Date"),
    gmailLabels: payload.labelIds ?? [],
    input,
    classification: classifyOpportunityEmail(input),
  };
}

async function fetchMetadataInBatches(
  accessToken: string,
  ids: string[],
  batchSize = 8,
) {
  const messages: ClassifiedInboxDraft[] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    const batchMessages = await Promise.all(
      batch.map((id) => getInboxMessageMetadata(accessToken, id)),
    );
    messages.push(...batchMessages);
  }
  return messages;
}

async function applyThreadContextToUnknown(
  accessToken: string,
  drafts: ClassifiedInboxDraft[],
) {
  const unresolved = drafts.filter(
    (draft) => draft.classification.label === "unknown",
  );
  if (unresolved.length === 0) {
    return drafts;
  }

  const subjectsByThread = await fetchThreadSubjectsById(
    accessToken,
    unresolved.map((draft) => draft.threadId),
  );

  return drafts.map((draft) => {
    if (draft.classification.label !== "unknown") {
      return draft;
    }

    return {
      ...draft,
      classification: applyThreadContext(
        draft.input,
        draft.classification,
        subjectsByThread.get(draft.threadId) ?? [],
      ),
    };
  });
}

export async function listRecentInboxMessages(
  userGoogleSub: string,
  maxResults: number = DEFAULT_INBOX_SAMPLE_SIZE,
): Promise<InboxMessagesResult> {
  try {
    const refreshToken = await getGmailRefreshToken(userGoogleSub);
    if (!refreshToken) {
      return { ok: false, reason: "reconnect_required" };
    }

    const accessToken = await refreshGmailAccessToken(refreshToken);
    const refs = await listInboxMessageRefs(accessToken, maxResults);
    const drafts = await fetchMetadataInBatches(
      accessToken,
      refs.map((ref) => ref.id),
    );
    const resolved = await applyThreadContextToUnknown(accessToken, drafts);

    return { ok: true, messages: resolved.map(toInboxMessage) };
  } catch (error) {
    if (error instanceof GmailAccessError) {
      return { ok: false, reason: error.reason };
    }
    return { ok: false, reason: "temporary_error" };
  }
}
