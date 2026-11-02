import { useEffect, useState } from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, continueRender, delayRender, staticFile, useVideoConfig } from "remotion";
import timeline from "../timeline.json";
import { Camera } from "./Camera";
import { Captions } from "./Captions";
import { Chaos } from "./Chaos";
import { Closing } from "./Closing";
import { C, FONT } from "./tokens";

/**
 * The film: real product footage (recorded from /demo/presentation in film mode), plus everything a
 * screen recording cannot give you: an intro, camera emphasis, captions, a closing frame and sound.
 * All timing comes from timeline.json, which is derived from the voice clips.
 */
const FOOTAGE_H = 1104;

export function Film() {
  const { fps } = useVideoConfig();
  const [handle] = useState(() => delayRender("Loading Instrument Sans"));
  useEffect(() => {
    const face = new FontFace("Instrument Sans", `url(${staticFile("fonts/InstrumentSans.woff2")})`, { weight: "400 700" });
    face.load().then(() => {
      document.fonts.add(face);
      continueRender(handle);
    });
  }, [handle]);

  const footageFrames = Math.round(timeline.film.historyEnd * fps);
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: FONT }}>
      {/* the product occupies the top 1104px; the bottom band is reserved for captions, so they can never cover UI */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: FOOTAGE_H, overflow: "hidden" }}>
        <Camera>
          <Sequence durationInFrames={footageFrames}>
            <OffthreadVideo src={staticFile("raw/product-30.mp4")} style={{ width: "100%", height: "100%" }} muted />
          </Sequence>
        </Camera>
      </div>
      <Chaos />
      <Closing />
      <Captions />
      {timeline.voice.provisional ? (
        <div style={{ position: "absolute", left: 26, bottom: 18, fontSize: 15, color: C.ink3, opacity: 0.8, fontFamily: FONT, letterSpacing: "-0.005em" }}>
          Provisional narration (system voice)
        </div>
      ) : null}
      <Audio src={staticFile("audio/soundtrack.wav")} />
    </AbsoluteFill>
  );
}
