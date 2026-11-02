import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";

/** The signed-in user's Google subject id, or a redirect to the landing page. */
export async function requireUserSub() {
  const session = await auth();
  const sub = session?.user?.googleSub;
  if (!sub || !isDatabaseConfigured()) redirect("/");
  return sub;
}
