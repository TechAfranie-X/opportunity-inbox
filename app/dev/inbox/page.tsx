import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { InboxMessages } from "@/app/components/inbox-messages";
import { isDatabaseConfigured } from "@/lib/db";
import { findGmailConnection } from "@/lib/gmail/credentials";
import {
  DEFAULT_INBOX_SAMPLE_SIZE,
  LARGE_INBOX_SAMPLE_SIZE,
  listRecentInboxMessages,
  parseInboxSampleSize,
} from "@/lib/gmail/messages";

/**
 * Developer-only: the original metadata-level "is this an opportunity?"
 * classifier with its hand-labelling UI. Kept because it is useful ground-truth
 * tooling for the noise filter; not part of the product surface.
 */
export default async function DevInbox({ searchParams }: PageProps<"/dev/inbox">) {
  if (process.env.NODE_ENV !== "development") notFound();

  const session = await auth();
  const sub = session?.user?.googleSub;
  const params = await searchParams;
  const size = parseInboxSampleSize(params.count);
  const connection = sub && isDatabaseConfigured() ? await findGmailConnection(sub) : null;
  const inbox = connection && sub ? await listRecentInboxMessages(sub, size) : null;
  const { InboxEvaluation } = await import("@/app/components/inbox-evaluation");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-xl font-semibold">Classifier evaluation (dev)</h1>
      <p className="mt-2 text-xs text-zinc-500">
        {inbox?.ok ? `Showing ${inbox.messages.length} recent INBOX messages. ` : "Sign in and connect Gmail first. "}
        <a className={size === DEFAULT_INBOX_SAMPLE_SIZE ? "font-medium" : "underline"} href={`/dev/inbox?count=${DEFAULT_INBOX_SAMPLE_SIZE}`}>{DEFAULT_INBOX_SAMPLE_SIZE}</a>
        {" · "}
        <a className={size === LARGE_INBOX_SAMPLE_SIZE ? "font-medium" : "underline"} href={`/dev/inbox?count=${LARGE_INBOX_SAMPLE_SIZE}`}>{LARGE_INBOX_SAMPLE_SIZE}</a>
      </p>
      {inbox?.ok ? <InboxEvaluation messages={inbox.messages} /> : null}
      {inbox?.ok ? null : <InboxMessages messages={[]} />}
    </main>
  );
}
