import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "../timeline.json";
import { C, FONT, S } from "./tokens";

/** The inbox without the product: subject fragments, quiet, in the product's own type. Resolves as Today arrives. */
const FRAGMENTS = [
  { t: "Thank you for applying to Brightwater Labs", x: 7, y: 26, s: 15, o: 0.5, d: 0.2 },
  { t: "Your online assessment", x: 58, y: 20, s: 17, o: 0.42, d: 0.55 },
  { t: "Quick chat?", x: 33, y: 40, s: 19, o: 0.36, d: 0.9 },
  { t: "Re: Your interview is confirmed", x: 60, y: 47, s: 14, o: 0.5, d: 1.2 },
  { t: "Update on your application", x: 10, y: 58, s: 16, o: 0.4, d: 1.5 },
  { t: "Reminder: your coding challenge closes tomorrow", x: 41, y: 64, s: 14, o: 0.46, d: 1.8 },
  { t: "Schedule your interview", x: 72, y: 72, s: 18, o: 0.34, d: 2.1 },
  { t: "Interview availability", x: 8, y: 77, s: 15, o: 0.4, d: 2.4 },
  { t: "Your offer letter", x: 46, y: 30, s: 15, o: 0.36, d: 2.7 },
  { t: "Thanks for completing your assessment", x: 22, y: 70, s: 13, o: 0.3, d: 3.0 },
];

export function Chaos() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const { outStart, outEnd } = timeline.film.chaos;
  if (t > outEnd + 0.3) return null;
  const top = 56 * S;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, bottom: 0, overflow: "hidden" }}>
      {FRAGMENTS.map((f, i) => {
        const tin = timeline.film.chaos.in + f.d / 2.4;
        const appear = interpolate(t, [tin, tin + 0.9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
        const leave = interpolate(t, [outStart, outEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
        const drift = Math.sin(t * 0.7 + i) * 5;
        return (
          <span
            key={f.t}
            style={{
              position: "absolute",
              left: `${f.x}%`,
              top: `${f.y}%`,
              fontFamily: FONT,
              fontSize: f.s * S,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              color: C.ink3,
              opacity: Math.min(0.85, f.o * 1.55) * appear * (1 - leave),
              transform: `translate(${drift}px, ${-Math.cos(t * 0.6 + i) * 6 + leave * 12}px)`,
            }}
          >
            {f.t}
          </span>
        );
      })}
    </div>
  );
}
