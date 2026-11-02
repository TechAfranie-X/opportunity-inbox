import { type GmailInboxMessage } from "@/lib/gmail/inbox-message";
import {
  classificationBadgeClass,
  classificationDisplayLabel,
} from "@/lib/opportunities/classify";
import { type ReactNode } from "react";

function ClassificationBadge({
  label,
}: {
  label: GmailInboxMessage["classificationLabel"];
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${classificationBadgeClass(label)}`}
    >
      {classificationDisplayLabel(label)}
    </span>
  );
}

function ClassificationWhy({ message }: { message: GmailInboxMessage }) {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const providerNames = Object.entries(message.providerSignals)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  const gmailSignals = message.gmailLabels.filter(
    (label) =>
      label.startsWith("CATEGORY_") ||
      label === "IMPORTANT" ||
      label === "STARRED",
  );

  return (
    <details className="mt-2 text-left">
      <summary className="cursor-pointer text-xs font-medium text-zinc-500">
        Why?
      </summary>
      <div className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <p>intent {message.intent}</p>
        <p>
          pipeline {message.pipelineScore} · opportunity{" "}
          {message.opportunityScore} · noise {message.noiseScore} · bulk{" "}
          {message.bulkScore} · directness {message.directnessScore}
        </p>
        {message.matchedSignals.length === 0 &&
        providerNames.length === 0 &&
        gmailSignals.length === 0 ? (
          <p>No deterministic signals.</p>
        ) : (
          <ul className="list-disc pl-4">
            {providerNames.map((name) => (
              <li key={name}>provider:{name}</li>
            ))}
            {gmailSignals.map((label) => (
              <li key={label}>gmail:{label}</li>
            ))}
            {message.matchedSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function InboxMessageRow({
  message,
  active = false,
  hideClassifier = false,
  onActivate,
  children,
}: {
  message: GmailInboxMessage;
  active?: boolean;
  hideClassifier?: boolean;
  onActivate?: () => void;
  children?: ReactNode;
}) {
  return (
    <li
      id={`eval-row-${message.id}`}
      className={`rounded-md border px-4 py-3 ${
        active
          ? "border-zinc-800 ring-2 ring-zinc-800/20 dark:border-zinc-200 dark:ring-zinc-200/20"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
      onClick={onActivate}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-balance">
          {message.subject || "(No subject)"}
        </p>
        {hideClassifier ? null : (
          <ClassificationBadge label={message.classificationLabel} />
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {message.from || "Unknown sender"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{message.date || "Unknown date"}</p>
      {children}
      {hideClassifier ? null : <ClassificationWhy message={message} />}
    </li>
  );
}

export function InboxMessages({ messages }: { messages: GmailInboxMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="mt-8 text-sm text-zinc-500">No messages in INBOX.</p>
    );
  }

  return (
    <ul className="mt-8 w-full space-y-3 text-left">
      {messages.map((message) => (
        <InboxMessageRow key={message.id} message={message} />
      ))}
    </ul>
  );
}
