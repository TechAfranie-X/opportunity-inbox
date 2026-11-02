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

// Gains in dB, relative to the voice. The licensed track (audio/clean-product-confidence-1.mp3) is the only music.
// Against that track the periodic UI ticks (settle/stage/slide) fought its 105 bpm groove and made the mix busy, and
// "resolve" is replaced by the track's own ending, so only the inspector "open" remains, on the track's drop.
const GAIN = { open: -22 };
const KEEP = new Set(Object.keys(GAIN));

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
build("sfx", timeline.sfx.filter((c) => KEEP.has(c.id)).map((c) => ({ file: sfxFile(c), t: c.t, db: GAIN[c.id] })));

// music: the track, edited to fit and ducked under the voice (scripts/make-music.py prints its measurements)
const py = path.resolve(root, "../.venv-kokoro/bin/python");
const mk = spawnSync(py, [path.join(root, "scripts/make-music.py")], { encoding: "utf8" });
if (mk.status !== 0) throw new Error(mk.stderr);
process.stdout.write(mk.stdout);

// combine; a voice+music preview is written first so the speech/music balance can be checked on its own
const combine = "[0:a][1:a][2:a]amix=inputs=3:normalize=0:dropout_transition=0[pre]";
const inputs = ["-i", path.join(stems, "voice.wav"), "-i", path.join(stems, "sfx.wav"), "-i", path.join(stems, "music.wav")];
ff(["-i", path.join(stems, "voice.wav"), "-i", path.join(stems, "music.wav"), "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.89[o]", "-map", "[o]", "-ar", "48000", "-c:a", "pcm_s16le", path.join(sfxDir, "preview-voice-music.wav")]);

// two-pass loudnorm to -14 LUFS integrated, -1.2 dBTP
const probe = spawnSync("ffmpeg", ["-y", "-v", "info", ...inputs, "-filter_complex", `${combine};[pre]loudnorm=I=-14:TP=-1.2:LRA=7:print_format=json[o]`, "-map", "[o]", "-f", "null", "-"], { encoding: "utf8" });
const log = `${probe.stderr}`;
const m = JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1));
// Master: one linear gain for the whole mix, a gentle 2:1 compressor that only acts above -5 dBFS (the narration's peaks;
// the music sits far below it, so the voice/music ratio is unchanged), then a fast peak limiter for strays. The gain is iterated until the *limited* result is on target.
const TARGET_LUFS = -14.0, LIMIT = 1.0; // full-scale ceiling; ffmpeg's alimiter lands about 3-4 dB under its limit in practice, so the result measures near -1.5 dBTP
const wav = path.join(root, "public/audio/soundtrack.wav");
const measure = (file) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const sum = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)[1]), tp: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)[1]) };
};
let gain = TARGET_LUFS - Number(m.input_i);
for (let i = 0; i < 6; i++) {
  ff([...inputs, "-filter_complex", `${combine};[pre]volume=${gain.toFixed(3)}dB,acompressor=threshold=0.55:ratio=2:attack=6:release=120:knee=6:makeup=1,alimiter=limit=${LIMIT}:attack=3:release=40:level=disabled[o]`, "-map", "[o]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", wav]);
  const r = measure(wav);
  console.log(`master pass ${i + 1}: gain ${gain.toFixed(2)} dB -> ${r.lufs} LUFS, ${r.tp} dBTP`);
  if (Math.abs(r.lufs - TARGET_LUFS) < 0.08) break;
  gain += TARGET_LUFS - r.lufs;
}
const siteDir = path.resolve(root, "../public/demo");
fs.mkdirSync(siteDir, { recursive: true });
ff(["-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", path.join(siteDir, "soundtrack.mp3")]);
console.log("mixed:", wav, "->", path.join(siteDir, "soundtrack.mp3"), `(${total}s)`);
