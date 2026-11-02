#!/usr/bin/env node
/**
 * Records the real product tour (the /demo/presentation route in film mode) as clean raw footage:
 * 1920x1104, no browser chrome, no cursor, no overlays. Time zero is the route's own script clock
 * (performance mark "presentation-start"), and the clip ends at timeline.product.endMs, so it lines up
 * with the narration timeline exactly.
 *
 *   node scripts/record-raw.mjs [--url=http://localhost:3100] [--out=public/raw/product.mp4]
 * Requires the PRODUCTION build to be running (npm run build && npx next start -p 3100 in the app root).
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const base = arg("url", "http://localhost:3100");
const out = path.resolve(root, arg("out", "public/raw/product.mp4"));
const W = 1920, H = 1104, FPS = 60; // the film canvas is 1920x1200; the bottom 96px is a caption band
const timeline = JSON.parse(fs.readFileSync(path.join(root, "timeline.json"), "utf8"));
const endS = timeline.product.endMs / 1000;

const work = path.join(root, ".rec");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "no-preference" });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__ev = {};
  const read = () => { const m = performance.getEntriesByName("presentation-start")[0]; if (m && !window.__ev.start) window.__ev.start = performance.timeOrigin + m.startTime; };
  setInterval(read, 20);
});

// Apply the viewport fully before the screencast locks its frame size.
await page.goto("about:blank");
await page.setViewportSize({ width: W, height: H });
await page.waitForTimeout(500);
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", (f) => {
  const file = path.join(work, `f${String(frames.length).padStart(5, "0")}.png`);
  fs.writeFileSync(file, Buffer.from(f.data, "base64"));
  frames.push({ file, ts: f.metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: W, maxHeight: H });
await page.goto(`${base}/demo/presentation?film=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ev?.start, null, { timeout: 30000, polling: 50 });
const start = (await page.evaluate(() => window.__ev.start)) / 1000;
await page.waitForTimeout((endS + 0.8) * 1000);
await cdp.send("Page.stopScreencast");
await browser.close();

// Build a constant-frame-rate clip from variable-timestamp frames, covering [start, start+endS].
const end = start + endS;
let first = frames.findLastIndex((f) => f.ts <= start);
if (first < 0) first = 0;
const list = [];
for (let i = first; i < frames.length && frames[i].ts < end; i += 1) {
  const from = Math.max(frames[i].ts, start);
  const to = Math.min(frames[i + 1]?.ts ?? end, end);
  if (to - from > 0.0005) list.push(`file '${frames[i].file}'\nduration ${(to - from).toFixed(6)}`);
}
const lastFile = list.length ? list[list.length - 1].match(/file '(.*)'/)[1] : frames[first].file;
fs.writeFileSync(path.join(work, "concat.txt"), `${list.join("\n")}\nfile '${lastFile}'`);
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(work, "concat.txt"), "-t", endS.toFixed(3),
  "-vf", `fps=${FPS},scale=${W}:${H}:flags=lanczos:in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-r", String(FPS), "-an", "-movflags", "+faststart", out,
]);
// Remotion seeks per frame, so give it an all-intra clip at the composition frame rate: instant seeks, no decode cache blow-up.
const proxy = out.replace(/\.mp4$/, "-30.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", out, "-r", "30", "-c:v", "libx264", "-g", "1", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an", proxy]);
const sizes = new Set(frames.map((f) => fs.statSync(f.file).size > 0));
console.log(JSON.stringify({ frames: frames.length, used: list.length, seconds: endS, out, ok: [...sizes] }));
fs.rmSync(work, { recursive: true, force: true });
