import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "../timeline.json";
import { C, FONT, S } from "./tokens";

const STAGES = ["Applied", "Recruiter", "Assessment", "Interview", "Offer"];
const rise = (t: number, at: number, dur = 0.7) => ({
  opacity: interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }),
  transform: `translateY(${interpolate(t, [at, at + dur], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px)`,
});

/** The closing frame: the journey line draws itself, lighting each stage, then the name and the line. */
export function Closing() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps - timeline.film.closingStart; // seconds since the closing began
  if (t < 0) return null;
  const cover = interpolate(t, [0, 0.55], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const width = 30 * 16 * S * 0.72; // matches the product's closing line
  const draw = interpolate(t, [0.25, 1.75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  return (
    <div style={{ position: "absolute", inset: 0, background: `rgba(248,246,242,${cover})`, display: "grid", placeContent: "center", justifyItems: "center", textAlign: "center", fontFamily: FONT }}>
      <div style={{ position: "relative", width, height: 76, marginBottom: 58, opacity: cover }}>
        <div style={{ position: "absolute", top: 5, left: 0, width: width * draw, height: 1.5, background: C.ink }} />
        {STAGES.map((label, i) => {
          const at = 0.3 + i * 0.34;
          const last = i === STAGES.length - 1;
          return (
            <div key={label} style={{ position: "absolute", left: `${i * 25}%`, top: 0, width: 0, display: "flex", flexDirection: "column", alignItems: "center", ...rise(t, at, 0.4) }}>
              <i style={{ display: "block", width: 11, height: 11, borderRadius: "50%", background: last ? C.accent : C.ink, boxShadow: last ? `0 0 0 8px ${C.accentWash}` : "none" }} />
              <span style={{ marginTop: 14, fontSize: 17, color: C.ink3, whiteSpace: "nowrap", letterSpacing: "-0.005em" }}>{label}</span>
            </div>
          );
        })}
      </div>
      <h1 style={{ margin: 0, fontSize: 70, fontWeight: 600, letterSpacing: "-0.034em", lineHeight: 1.06, color: C.ink, ...rise(t, 0.55, 0.8) }}>Opportunity Inbox</h1>
      <p style={{ margin: "18px 0 0", fontSize: 28, color: C.ink2, letterSpacing: "-0.012em", ...rise(t, 0.95, 0.8) }}>Your recruiting life, organized automatically.</p>
    </div>
  );
}
