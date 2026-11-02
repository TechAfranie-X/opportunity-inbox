import { type ReactNode } from "react";

export function dayPart(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function countLine(n: number) {
  if (n === 0) return "Nothing needs you today.";
  return n === 1 ? "1 thing needs you today." : `${n} things need you today.`;
}

/**
 * The briefing's opening. The only choreographed motion in the product: the two lines settle in
 * one after the other. Priority is carried by size and position, not by colour.
 */
export function Greeting({
  name,
  hour,
  needsYou,
  children,
}: {
  name?: string;
  hour: number;
  needsYou: number | null;
  /** Small line under the headline: date, freshness, refresh. */
  children?: ReactNode;
}) {
  return (
    <div>
      <h1 className="t-greeting">
        <span className="settle block">
          {dayPart(hour)}
          {name ? `, ${name}.` : "."}
        </span>
        <span className="settle settle-2 block text-ink-3">
          {needsYou === null ? "Reading your recruiting emails." : countLine(needsYou)}
        </span>
      </h1>
      {children ? <div className="t-meta mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-3">{children}</div> : null}
    </div>
  );
}
