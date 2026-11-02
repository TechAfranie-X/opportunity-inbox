import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReactNode } from "react";
import timeline from "../timeline.json";

type Key = { t: number; scale: number; fx: number; fy: number };
const keys = timeline.camera as Key[];

/** Gentle 2-5% emphases only. The focus point stays put while the rest of the frame opens around it. */
export function useCamera(): { scale: number; fx: number; fy: number } {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const i = Math.max(0, keys.findLastIndex((k) => k.t <= t));
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  if (a === b || b.t === a.t) return a;
  const p = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
  return {
    scale: interpolate(p, [0, 1], [a.scale, b.scale]),
    fx: interpolate(p, [0, 1], [a.fx, b.fx]),
    fy: interpolate(p, [0, 1], [a.fy, b.fy]),
  };
}

export function Camera({ children }: { children: ReactNode }) {
  const { scale, fx, fy } = useCamera();
  return (
    <div style={{ position: "absolute", inset: 0, transformOrigin: `${fx * 100}% ${fy * 100}%`, transform: `scale(${scale})`, willChange: "transform" }}>
      {children}
    </div>
  );
}
