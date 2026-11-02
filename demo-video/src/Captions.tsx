import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "../timeline.json";
import { C, FONT } from "./tokens";

/** Lower-third captions: plain text on the caption band, one spoken phrase at a time, never word by word. */
export const CAPTION_BOTTOM = 112; // px above the bottom edge of the 1920x1200 master (brief: 100-130)
/** Per-scene vertical nudges in px (positive = up). Add an entry by narration line id if a scene needs it. */
const LIFT: Record<string, number> = {};

export function Captions() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cap = timeline.captions.find((c) => t >= c.start && t <= c.end && c.line !== "l8"); // l8 is the on-screen tagline
  if (!cap) return null;
  const a = interpolate(t, [cap.start, cap.start + 0.14, cap.end - 0.14, cap.end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: CAPTION_BOTTOM + (LIFT[cap.line] ?? 0), display: "flex", justifyContent: "center", pointerEvents: "none", opacity: a }}>
      <span
        style={{
          fontFamily: FONT,
          fontSize: 23,
          fontWeight: 500,
          lineHeight: 1.35,
          letterSpacing: "-0.008em",
          color: C.ink,
          textAlign: "center",
          maxWidth: 1100, // about 57% of the frame
          textWrap: "balance",
        }}
      >
        {cap.text}
      </span>
    </div>
  );
}
