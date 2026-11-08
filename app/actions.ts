"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { fromInputValue } from "@/lib/recruiting/format";
import { requireUserSub } from "@/lib/recruiting/session";
import {
  disconnectGmail,
  deleteRecruitingData,
  dismissAction,
  confirmEvent,
  editEvent,
  ignoreEvent,
  resetEvent,
  recordUsage,
  setOpportunityStatus,
} from "@/lib/recruiting/store";
import { isSyncLocked } from "@/app/sync-lock";
import { readShadowConfig } from "@/lib/recruiting/shadow/config";
import { syncRecruitingMail } from "@/lib/recruiting/sync";
import { EVENT_TYPES, type EventType } from "@/lib/recruiting/types";

export type SyncState =
  | { status: "idle" }
  | { status: "error"; message: string; reconnect: boolean };

const SYNC_ERRORS = {
  not_connected: "Connect Gmail first.",
  reconnect_required: "Gmail access expired. Please reconnect Gmail.",
  temporary_error: "Couldn't reach Gmail. Try again in a minute.",
} as const;

/**
 * Architecture v2 shadow mode (READER_V2_SHADOW=1; off by default). Runs AFTER the response, so it can neither slow nor
 * fail the user's sync, and it only writes the shadow_reads table, which nothing in the product reads. Loaded lazily so a
 * disabled flag costs nothing. Errors are reduced to a type name: no message content is ever logged.
 */
function scheduleShadowCollection(sub: string) {
  if (!readShadowConfig().enabled) return;
  after(async () => {
    try {
      const { collectShadow } = await import("@/lib/recruiting/shadow/collect");
      await collectShadow(sub);
    } catch (error) {
      console.error("shadow collection failed:", error instanceof Error ? error.name : "unknown");
    }
  });
}

export async function syncAction(): Promise<SyncState> {
  const sub = await requireUserSub();
  // Checked before any Gmail, extractor or database work. See app/sync-lock.ts.
  if (isSyncLocked()) return { status: "error", message: "Sync is disabled during BLIND setup.", reconnect: false };
  const result = await syncRecruitingMail(sub);
  if (!result.ok) return { status: "error", message: SYNC_ERRORS[result.reason], reconnect: result.reason === "reconnect_required" };
  await recordUsage(sub, "sync");
  scheduleShadowCollection(sub);
  revalidatePath("/", "layout");
  return { status: "idle" };
}

function text(form: FormData, name: string, max = 160) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function editEventAction(form: FormData) {
  const sub = await requireUserSub();
  const eventId = text(form, "eventId", 64);
  const type = text(form, "type", 40);
  if (!eventId || !(EVENT_TYPES as string[]).includes(type)) return;
  await editEvent(sub, eventId, {
    type: type as EventType,
    company: text(form, "company", 120),
    role: text(form, "role") || null,
    eventDate: fromInputValue(text(form, "eventDate", 20)),
  });
  await recordUsage(sub, "correction");
  revalidatePath("/", "layout");
}

export async function ignoreEventAction(form: FormData) {
  const sub = await requireUserSub();
  await ignoreEvent(sub, text(form, "eventId", 64));
  await recordUsage(sub, "correction");
  revalidatePath("/", "layout");
}

export async function resetEventAction(form: FormData) {
  const sub = await requireUserSub();
  await resetEvent(sub, text(form, "eventId", 64));
  revalidatePath("/", "layout");
}

/** "Looks right": an explicit confirmation, kept as a label. An untouched prediction is never assumed correct. */
export async function confirmEventAction(form: FormData) {
  const sub = await requireUserSub();
  await confirmEvent(sub, text(form, "eventId", 64));
  await recordUsage(sub, "confirmation");
  revalidatePath("/", "layout");
}

export async function setOpportunityStatusAction(form: FormData) {
  const sub = await requireUserSub();
  const status = text(form, "status", 10);
  await setOpportunityStatus(sub, text(form, "key", 200), status === "closed" ? "closed" : status === "active" ? "active" : null);
  await recordUsage(sub, "correction");
  revalidatePath("/", "layout");
}

export async function dismissActionAction(form: FormData) {
  const sub = await requireUserSub();
  await dismissAction(sub, text(form, "actionId", 300));
  await recordUsage(sub, "dismiss_action");
  revalidatePath("/", "layout");
}

export async function deleteMyDataAction() {
  const sub = await requireUserSub();
  await deleteRecruitingData(sub);
  revalidatePath("/", "layout");
  redirect("/today");
}

export async function disconnectGmailAction() {
  const sub = await requireUserSub();
  await disconnectGmail(sub);
  await signOut({ redirectTo: "/" });
}
