#!/usr/bin/env node
/**
 * Synthesises the (very restrained) sound design and a quiet ambient bed with ffmpeg. Everything here is
 * generated from sine waves and filtered noise, so it is original and carries no licensing baggage.
 * Output: .sfx/*.wav (mono, 48 kHz). Gains are applied later, in mix-audio.mjs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, ".sfx");
fs.mkdirSync(dir, { recursive: true });
const timeline = JSON.parse(fs.readFileSync(path.join(root, "timeline.json"), "utf8"));

const synth = (name, expr, dur, post = "") => {
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=48000:d=${dur}`];
  if (post) args.push("-af", post);
  args.push("-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(dir, `${name}.wav`));
  execFileSync("ffmpeg", args);
};

// open: a soft, low, rounded thud: the inspector arriving (no whoosh)
synth("open", "0.55*sin(2*PI*174.6*t)*exp(-t*13)+0.18*sin(2*PI*349.2*t)*exp(-t*20)", 0.45, "lowpass=f=900,afade=t=in:d=0.004");

// settle: tiny warm blips, a rising pentatonic ladder: an entry settling into place. Six pitches.
const settleHz = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77];
settleHz.forEach((hz, i) => synth(`settle${i}`, `0.5*sin(2*PI*${hz}*t)*exp(-t*55)+0.12*sin(2*PI*${hz * 2}*t)*exp(-t*90)`, 0.12, "afade=t=in:d=0.003,lowpass=f=3500"));

// stage: a slightly rounder two-partial tone: the journey marker landing on a stage
synth("stage", "0.5*sin(2*PI*659.25*t)*exp(-t*9)+0.22*sin(2*PI*987.77*t)*exp(-t*13)", 0.5, "lowpass=f=3000,afade=t=in:d=0.004");

// slide: air, not a whoosh: soft band-limited noise with a slow swell, for scene changes
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=0.6:c=pink:r=48000:a=0.5", "-af",
  "bandpass=f=1100:w=1.1,lowpass=f=2400,afade=t=in:st=0:d=0.22:curve=qsin,afade=t=out:st=0.28:d=0.32:curve=qsin", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(dir, "slide.wav")]);

// resolve: the brand landing: a gentle open fifth plus a third, slow decay
synth("resolve",
  "0.34*sin(2*PI*392*t)*exp(-t*1.7)+0.28*sin(2*PI*523.25*t)*exp(-t*1.9)+0.2*sin(2*PI*659.25*t)*exp(-t*2.3)",
  3.0, "lowpass=f=2600,afade=t=in:d=0.03,afade=t=out:st=2.2:d=0.8");

// bed: ambient pad: C G C E drifting very slowly. Not music so much as a floor of warmth. Extremely quiet once mixed.
const bedLen = Math.ceil(timeline.duration + 1.5);
const lfo = (hz, ph) => `(0.6+0.4*sin(2*PI*${hz}*t+${ph}))`;
synth("bed",
  `0.30*${lfo(0.043, 0)}*sin(2*PI*130.81*t)+0.22*${lfo(0.057, 1.3)}*sin(2*PI*196*t)+0.16*${lfo(0.071, 2.1)}*sin(2*PI*261.63*t)+0.10*${lfo(0.083, 0.4)}*sin(2*PI*329.63*t)`,
  bedLen, `lowpass=f=1100,afade=t=in:d=2.5,afade=t=out:st=${bedLen - 3}:d=3`);

console.log("synthesised:", fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).join(" "));
