#!/usr/bin/env node
/**
 * Mixes the soundtrack: voice (placed from the timeline), restrained SFX, and a quiet ambient bed that is
 * ducked under speech, then normalises loudness. Writes:
 *   public/audio/soundtrack.wav      (for the Remotion film)
 *   ../public/demo/soundtrack.mp3    (for the live narrated route)
 *   .sfx/stems/{voice,sfx,bed}.wav   (for level analysis)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sfxDir = path.join(root, ".sfx");
const stems = path.join(sfxDir, "stems");
fs.mkdirSync(stems, { recursive: true });
fs.mkdirSync(path.join(root, "public/audio"), { recursive: true });
const timeline = JSON.parse(fs.readFileSync(path.join(root, "timeline.json"), "utf8"));
const total = timeline.duration;

// Gains in dB, relative to the voice. SFX are felt, not heard; the bed is a floor.
const GAIN = { open: -17, settle: -25, stage: -21, slide: -27, resolve: -15 };
const BED_DB = -33;

const ff = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
const sfxFile = (c) => path.join(sfxDir, c.id === "settle" ? `settle${(c.n ?? 0) % 6}.wav` : `${c.id}.wav`);

function build(stem, items, extra = "") {
  const inputs = [];
  const chains = [];
  items.forEach((it, i) => {
    inputs.push("-i", it.file);
    const ms = Math.round(it.t * 1000);
    chains.push(`[${i}:a]${it.pre ?? ""}volume=${it.db}dB,adelay=${ms}|${ms}[a${i}]`);
  });
  const labels = items.map((_, i) => `[a${i}]`).join("");
  const filter = `${chains.join(";")};${labels}amix=inputs=${items.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total}${extra}[out]`;
  ff([...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(stems, `${stem}.wav`)]);
}

// voice: a touch of presence, gentle compression so it sits evenly
const voiceItems = Object.entries(timeline.lines).map(([id, l]) => ({
  file: path.join(root, "voice/clips", `${id}.wav`), t: l.start, db: 0,
  pre: "highpass=f=75,acompressor=threshold=-22dB:ratio=2.2:attack=6:release=90:makeup=2,",
}));
build("voice", voiceItems);

// sfx
build("sfx", timeline.sfx.map((c) => ({ file: sfxFile(c), t: c.t, db: GAIN[c.id] })));

// bed (a single long file, held low)
ff(["-i", path.join(sfxDir, "bed.wav"), "-af", `volume=${BED_DB}dB,apad=whole_dur=${total},atrim=0:${total}`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(stems, "bed.wav")]);

// combine: bed ducked under the voice (side-chain), then loudness-normalised
const combine = [
  "[2:a][0:a]sidechaincompress=threshold=0.015:ratio=10:attack=25:release=450:makeup=1[bedduck]",
  "[0:a][1:a][bedduck]amix=inputs=3:normalize=0:dropout_transition=0,alimiter=limit=0.89[pre]",
].join(";");
const inputs = ["-i", path.join(stems, "voice.wav"), "-i", path.join(stems, "sfx.wav"), "-i", path.join(stems, "bed.wav")];

// two-pass loudnorm to -16 LUFS integrated, -1.5 dBTP
const probe = spawnSync("ffmpeg", ["-y", "-v", "info", ...inputs, "-filter_complex", `${combine};[pre]loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json[o]`, "-map", "[o]", "-f", "null", "-"], { encoding: "utf8" });
const log = `${probe.stderr}`;
const m = JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1));
const ln = `loudnorm=I=-16:TP=-1.5:LRA=7:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const wav = path.join(root, "public/audio/soundtrack.wav");
ff([...inputs, "-filter_complex", `${combine};[pre]${ln}[o]`, "-map", "[o]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", wav]);
const siteDir = path.resolve(root, "../public/demo");
fs.mkdirSync(siteDir, { recursive: true });
ff(["-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", path.join(siteDir, "soundtrack.mp3")]);
console.log("mixed:", wav, "->", path.join(siteDir, "soundtrack.mp3"), `(${total}s)`);
