import raw from "./cues.json";

/**
 * Timing for the scripted presentation. Generated from the narration by `demo-video` (npm run timeline),
 * so the picture always lands on the words. Changing the voice re-times it; do not hand-edit.
 */
export type Cues = typeof raw;
export const CUES: Cues = raw;
