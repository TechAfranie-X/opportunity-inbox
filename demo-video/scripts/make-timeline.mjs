#!/usr/bin/env node
/**
 * Builds timeline.json: where every narration line, visual beat, camera move, sound cue and caption
 * falls. All of it is derived from the voice clip durations (voice/clips.json), so replacing the
 * voice and re-running `npm run timeline` re-times the entire film.
 *
 * Times are seconds on the film clock unless a key ends in `Ms`. The "product" block is what the
 * recorded product footage (the /demo/presentation route in film mode) needs, in milliseconds.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const clips = JSON.parse(fs.readFileSync(path.join(root, "voice/clips.json"), "utf8"));
const narration = JSON.parse(fs.readFileSync(path.join(root, "script/narration.json"), "utf8"));
const FPS = 30;
const r = (n) => Math.round(n * 1000) / 1000;

// --- narration placement: breathing room between lines, set by hand where the picture needs it
const GAP = { l1: 0.3, l2: 0.55, l3: 0.4, l4: 0.2, l5: 0.3, l6: 0.45, l7: 0.65 };
const FIRST_START = 0.45;
const HOLD_AFTER_LAST = 1.9;

const lines = {};
let t = FIRST_START;
for (const line of narration.lines) {
  const d = clips.clips[line.id].duration;
  lines[line.id] = { start: r(t), end: r(t + d), duration: d, text: line.text };
  t += d + (GAP[line.id] ?? 0);
}
const L = lines;
const duration = r(L.l8.end + HOLD_AFTER_LAST);

// --- visual beats, anchored to the words they illustrate
const todayMount = r(L.l2.end - 1.25); //            Today resolves as "...different threads" lands
const inspectorOpen = r(L.l3.end - 2.3); //          inspector glides in during "...one live recruiting workspace"
const entryFirst = r(inspectorOpen + 0.8); //        journey resolves, one entry at a time, and is held through "See what needs you today"
const entryStep = 0.4;
const pipelineStart = r(L.l5.start - 0.2); //        "follow every opportunity"
const stages = [
  ["applied", pipelineStart],
  ["assessment", r(L.l5.start + 1.45)], //           "from application"
  ["interview", r(L.l5.start + 2.35)], //            "to interview"
  ["offer", r(L.l5.start + 3.15)], //                "to offer"
];
const historyStart = r(L.l6.start + 0.4); //          "rebuild each company"
const histFirst = 0.45;
const histStep = 0.24; //                            12 entries land in ~2.7s, so the counter reads 12 while it is still in view
const historyScroll = [r(histFirst + 11 * histStep + 0.25), 2.6];
const closingStart = r(L.l8.start - 0.55);
const historyEnd = r(closingStart + 0.7); //         footage is held until the closing frame covers it

const product = {
  todayMountMs: Math.round(todayMount * 1000),
  inspectorOpenMs: Math.round(inspectorOpen * 1000),
  inspectorEntryFirstS: r(entryFirst - inspectorOpen),
  inspectorEntryStepS: entryStep,
  pipelineStartMs: Math.round(pipelineStart * 1000),
  stagesMs: stages.map(([id, s]) => [Math.round(s * 1000), id]),
  historyStartMs: Math.round(historyStart * 1000),
  historyFirstS: histFirst,
  historyStepS: histStep,
  historyScrollMs: [Math.round(historyScroll[0] * 1000), Math.round(historyScroll[1] * 1000)],
  endMs: Math.round(historyEnd * 1000),
};

// --- camera: gentle 2-5% emphases only, never on every interaction. (fx, fy) = focus in 0..1 footage space
const camera = [
  { t: 0, scale: 1.0, fx: 0.5, fy: 0.5 },
  { t: todayMount + 1.0, scale: 1.0, fx: 0.5, fy: 0.5 },
  { t: inspectorOpen - 0.1, scale: 1.03, fx: 0.36, fy: 0.5 }, //   slow push toward the hero
  { t: inspectorOpen + 0.9, scale: 1.04, fx: 0.64, fy: 0.46 }, //  glide toward the inspector as it arrives
  { t: pipelineStart - 0.1, scale: 1.04, fx: 0.64, fy: 0.46 },
  { t: pipelineStart + 0.7, scale: 1.0, fx: 0.5, fy: 0.5 }, //     release for Pipeline
  { t: pipelineStart + 1.0, scale: 1.0, fx: 0.5, fy: 0.5 },
  { t: pipelineStart + 1.9, scale: 1.035, fx: 0.3, fy: 0.22 }, //  "37 emails -> 14 opportunities"
  { t: stages[2][1] - 0.2, scale: 1.03, fx: 0.4, fy: 0.3 }, //     follow the marker
  { t: stages[3][1] + 0.5, scale: 1.0, fx: 0.5, fy: 0.5 },
  { t: historyStart + 0.4, scale: 1.0, fx: 0.5, fy: 0.5 },
  { t: historyStart + 1.3, scale: 1.04, fx: 0.86, fy: 0.12 }, //   "12 emails" counter, while it climbs to 12
  { t: historyStart + 3.2, scale: 1.04, fx: 0.86, fy: 0.12 },
  { t: historyStart + 3.9, scale: 1.0, fx: 0.5, fy: 0.5 },
  { t: duration, scale: 1.0, fx: 0.5, fy: 0.5 },
].map((k) => ({ ...k, t: r(k.t) }));

// --- captions: phrase chunks (max two lines), timed across each clip by character weight (pauses at punctuation)
function chunk(text) {
  const parts = text.match(/[^,.]+[,.]?\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && (last.length + p.length < 44 || p.split(" ").length < 3)) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}
const captions = [];
for (const line of narration.lines) {
  const { start, end } = L[line.id];
  const chunks = line.phrases ?? chunk(line.text);
  const weight = chunks.map((c) => c.length + (/[,.]$/.test(c) ? 5 : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  let cursor = start;
  chunks.forEach((c, i) => {
    const span = ((end - start) * weight[i]) / total;
    captions.push({ line: line.id, start: r(cursor - 0.05), end: r(cursor + span + (i === chunks.length - 1 ? 0.25 : 0)), text: c.replace(/,$/, ",") });
    cursor += span;
  });
}

// --- sound cues (the SFX themselves are synthesised by make-sfx.mjs)
const sfx = [
  { t: inspectorOpen, id: "open" },
  ...Array.from({ length: 6 }, (_, i) => ({ t: entryFirst + i * entryStep, id: "settle", n: i })),
  { t: pipelineStart - 0.05, id: "slide" },
  ...stages.slice(1).map(([, s]) => ({ t: s, id: "stage" })),
  { t: historyStart, id: "slide" },
  ...Array.from({ length: 6 }, (_, i) => ({ t: historyStart + histFirst + i * 2 * histStep, id: "settle", n: i })),
  { t: closingStart + 1.55, id: "resolve" },
].map((c) => ({ ...c, t: r(c.t) }));

const timeline = {
  fps: FPS,
  duration,
  durationFrames: Math.round(duration * FPS),
  voice: { provider: clips.provider, provisional: clips.provisional },
  lines,
  film: {
    chaos: { in: 0, outStart: r(todayMount - 1.0), outEnd: r(todayMount - 0.05) },
    todayMount, inspectorOpen, pipelineStart, historyStart, closingStart, historyEnd,
  },
  product,
  camera,
  captions,
  sfx,
};
fs.writeFileSync(path.join(root, "timeline.json"), JSON.stringify(timeline, null, 2));
console.log(`film ${duration}s (${timeline.durationFrames} frames @ ${FPS}fps)`);
for (const [id, l] of Object.entries(lines)) console.log(id, l.start.toFixed(2), "->", l.end.toFixed(2), l.text.slice(0, 50));
console.log({ todayMount, inspectorOpen, entryFirst: r(entryFirst), pipelineStart, stages: stages.map((s) => s[1]), historyStart, closingStart, historyEnd });
console.log("captions:", captions.length, "| sfx cues:", sfx.length);
