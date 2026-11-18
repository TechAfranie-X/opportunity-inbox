import { type ReactNode } from "react";

export function dayPart(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Nothing is due is not the same as nothing is wrong: while emails we are unsure about wait for a check, never say the person is clear. */
function countLine(n: number, toCheck = 0) {
  if (n === 0) return toCheck > 0 ? `Nothing is due today, but ${toCheck} ${toCheck === 1 ? "email needs" : "emails need"} a check.` : "Nothing needs you today.";
  if (n === 1) return "1 thing needs you today.";
  // A long list is not a verdict: say where to begin instead of announcing a number that reads as alarm.
  return n > 6 ? `${n} are open. Start with these.` : `${n} things need you today.`;
}

/**
 * The briefing's opening. The only choreographed motion in the product: the two lines settle in
 * one after the other. Priority is carried by size and position, not by colour.
 */
export function Greeting({
  name,
  hour,
  needsYou,
  toCheck = 0,
  children,
}: {
  name?: string;
  hour: number;
  needsYou: number | null;
  /** Emails waiting for a person to confirm what they say (the review queue). */
  toCheck?: number;
  /** Small line under the headline: date, freshness, refresh. */
  children?: ReactNode;
}) {
  return (
    <div>
      {children ? <div className="t-meta mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-3">{children}</div> : null}
      <h1 className="t-greeting">
        <span className="settle block">
          {dayPart(hour)}
          {name ? `, ${name}.` : "."}
        </span>
        <span className="settle settle-2 block text-ink-3">
          {needsYou === null ? "Reading your recruiting emails." : countLine(needsYou, toCheck)}
        </span>
      </h1>
    </div>
  );
}
