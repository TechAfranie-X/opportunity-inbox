import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "../timeline.json";
import { C, FONT, S } from "./tokens";

/** Neutral captions: two lines at most, phrase by phrase, in the product's type. Never word-by-word. */
export function Captions() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cap = timeline.captions.find((c) => t >= c.start && t <= c.end && c.line !== "l8"); // l8 is the on-screen tagline
  if (!cap) return null;
  const a = interpolate(t, [cap.start, cap.start + 0.16, cap.end - 0.16, cap.end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96, alignItems: "center", display: "flex", justifyContent: "center", pointerEvents: "none", opacity: a }}>
      <span
        style={{
          fontFamily: FONT,
          fontSize: 25,
          lineHeight: 1.32,
          letterSpacing: "-0.01em",
          color: C.ink,
          textAlign: "center",
          maxWidth: 17 * 56 * 0.84,
          padding: "11px 28px",
          borderRadius: 999,
          background: "rgba(248,246,242,0.94)",
          boxShadow: `0 0 0 1px ${C.line}`,
        }}
      >
        {cap.text}
      </span>
    </div>
  );
}
