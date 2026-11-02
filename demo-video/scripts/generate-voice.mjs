#!/usr/bin/env node
/**
 * Produces one clean WAV per narration line in voice/clips/ plus voice/clips.json (durations).
 * Providers (voice/voice.config.json -> "provider"):
 *   local-say   macOS system TTS. Free, local, PROVISIONAL. The default.
 *   human       your own recording: voice/human/<id>.wav|mp3|m4a|aiff
 *   elevenlabs  premium TTS. PAID. Refuses to run unless you pass --i-authorize-paid-api and
 *               set ELEVENLABS_API_KEY. (Implemented from the public API docs; not yet exercised.)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const narration = JSON.parse(fs.readFileSync(path.join(root, "script/narration.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(root, "voice/voice.config.json"), "utf8"));
const provider = process.argv.find((a) => a.startsWith("--provider="))?.split("=")[1] ?? config.provider;
const clipsDir = path.join(root, "voice/clips");
fs.mkdirSync(clipsDir, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const probe = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());

/** Normalise any source to 48 kHz mono WAV, trim leading/trailing silence, leave a little air. */
function clean(src, dest) {
  run("ffmpeg", [
    "-y", "-v", "error", "-i", src,
    "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,adelay=40|40,apad=pad_dur=0.06",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", dest,
  ]);
}

const out = { provider, provisional: provider === "local-say", generatedAt: new Date().toISOString(), clips: {} };

for (const line of narration.lines) {
  const dest = path.join(clipsDir, `${line.id}.wav`);
  if (provider === "local-say") {
    const cfg = config.providers["local-say"];
    const tmp = path.join(clipsDir, `${line.id}.aiff`);
    run("say", ["-v", cfg.voice, "-r", String(cfg.rate), "-o", tmp, line.text]);
    clean(tmp, dest);
    fs.rmSync(tmp);
  } else if (provider === "human") {
    const dir = path.join(root, config.providers.human.dir);
    const found = ["wav", "mp3", "m4a", "aiff"].map((e) => path.join(dir, `${line.id}.${e}`)).find((p) => fs.existsSync(p));
    if (!found) throw new Error(`No recording for ${line.id} in ${dir}`);
    clean(found, dest);
  } else if (provider === "elevenlabs") {
    if (!process.argv.includes("--i-authorize-paid-api") || !process.env.ELEVENLABS_API_KEY) {
      throw new Error("ElevenLabs is a PAID service. Re-run with --i-authorize-paid-api and ELEVENLABS_API_KEY set. Nothing was sent.");
    }
    const cfg = config.providers.elevenlabs;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: line.text, model_id: cfg.model }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const tmp = path.join(clipsDir, `${line.id}.mp3`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    clean(tmp, dest);
    fs.rmSync(tmp);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }
  out.clips[line.id] = { file: `voice/clips/${line.id}.wav`, duration: Number(probe(dest).toFixed(3)), text: line.text };
  console.log(line.id.padEnd(3), out.clips[line.id].duration.toFixed(2).padStart(5), "s ", line.text);
}
fs.writeFileSync(path.join(root, "voice/clips.json"), JSON.stringify(out, null, 2));
const total = Object.values(out.clips).reduce((s, c) => s + c.duration, 0);
console.log(`\n${provider}${out.provisional ? " (PROVISIONAL)" : ""}: ${total.toFixed(1)}s of speech`);
