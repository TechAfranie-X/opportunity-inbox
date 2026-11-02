import { journeyPosition, PULSE_STAGES } from "@/lib/recruiting/history";
import { STAGE_LABEL } from "@/lib/recruiting/format";
import type { Stage } from "@/lib/recruiting/types";

/**
 * Opportunity Inbox's signature: the journey line. One dot per stage on a hairline;
 * what has been reached is inked and the current stage glows in the accent.
 * A closed opportunity shows the line unreached (the outcome is written beside it).
 */
export function JourneyLine({
  stage,
  surface = "tint",
  className = "",
}: {
  stage: Stage;
  /** Which background the line sits on, so unreached dots match it. */
  surface?: "tint" | "paper" | "raised";
  className?: string;
}) {
  const { index, closed } = journeyPosition(stage);
  return (
    <div className={`jl ${className}`} data-surface={surface} role="img" aria-label={closed ? "Process ended" : `Stage: ${STAGE_LABEL[stage]}`}>
      <span className="jl-track" aria-hidden />
      {index > 0 ? <span className="jl-fill" style={{ width: `${index * 20}%` }} aria-hidden /> : null}
      {PULSE_STAGES.map((s, i) => (
        <div key={s} className="jl-col">
          <i className="jl-dot" data-reached={!closed && i <= index} data-current={!closed && i === index} />
          <span className={`mt-2 block whitespace-nowrap text-[0.6875rem] leading-tight ${!closed && i === index ? "font-semibold text-ink" : "text-ink-3"}`}>
            {STAGE_LABEL[s]}
          </span>
        </div>
      ))}
    </div>
  );
}
