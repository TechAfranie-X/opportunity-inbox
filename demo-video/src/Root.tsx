import { Composition } from "remotion";
import timeline from "../timeline.json";
import { Film } from "./Film";

export const Root = () => (
  <Composition
    id="Film"
    component={Film}
    durationInFrames={timeline.durationFrames}
    fps={timeline.fps}
    width={1920}
    height={1200}
  />
);
