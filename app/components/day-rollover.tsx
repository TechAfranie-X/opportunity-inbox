"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Today's wording ("tomorrow", "Interview today", how many days quiet) is computed on the server for the day the page was rendered. A tab left open across midnight would keep
 * saying yesterday's things, so the page asks the server again when the calendar day changes (a timer set for the next local midnight) and when the tab regains focus on a new day.
 */
const dayOf = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export function DayRollover() {
  const router = useRouter();
  const rendered = useRef<string>(dayOf());
  useEffect(() => {
    rendered.current = dayOf();
    const check = () => { if (dayOf() !== rendered.current) { rendered.current = dayOf(); router.refresh(); } };
    const untilMidnight = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5).getTime() - n.getTime(); };
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { timer = setTimeout(() => { check(); arm(); }, untilMidnight()); };
    arm();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);
  return null;
}
