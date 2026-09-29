import { type GmailInboxMessage } from "@/lib/gmail/messages";

export function InboxMessages({ messages }: { messages: GmailInboxMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="mt-8 text-sm text-zinc-500">No messages in INBOX.</p>
    );
  }

  return (
    <ul className="mt-8 w-full space-y-3 text-left">
      {messages.map((message) => (
        <li
          key={message.id}
          className="rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800"
        >
          <p className="text-sm font-medium text-balance">
            {message.subject || "(No subject)"}
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {message.from || "Unknown sender"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{message.date || "Unknown date"}</p>
        </li>
      ))}
    </ul>
  );
}
