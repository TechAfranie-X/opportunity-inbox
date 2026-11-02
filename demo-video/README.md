# Opportunity Inbox: product film pipeline

Isolated from the product. Nothing in the app imports from here; the app only receives two generated files
(`app/demo/presentation/cues.json` and `public/demo/soundtrack.mp3`). The real product stays the source of
truth for every pixel of UI: `/demo/presentation` on fictional data.

```
script/narration.json ──► voice (say | human | elevenlabs) ──► voice/clips/*.wav
                                                      │
                                      make-timeline ◄─┘   timeline.json (every cue derives from clip lengths)
                                           │
        record-raw  ◄── /demo/presentation?film=1        sfx + mix-audio ──► public/audio/soundtrack.wav
        public/raw/product.mp4 (1920×1200, no chrome, no overlays)                │
                           └──────────────► Remotion "Film": camera + intro + captions + closing + audio ──► out/film.mp4
```

## Build the film
Prerequisites: the product's **production** build running on :3100, ffmpeg, Google Chrome.

```bash
# in the app root
npm run build && npx next start -p 3100 &

cd demo-video
npm install
npm run voice        # narration clips (provisional macOS voice by default)
npm run timeline     # timeline.json + (copy to app) cues
node scripts/make-sfx.mjs && npm run mix
npm run record       # real product footage, timed to the narration
npm run render       # out/film.mp4
```
After `npm run timeline`, copy the slim cues into the app (see "Live narrated route" below) and rebuild the app
before recording, so the footage and the film agree.

## Swapping the voice
Everything re-times itself from the clip lengths.

1. **Your own recording** (best): record each line from `script/narration.json` and save as
   `voice/human/<id>.wav` (or `.mp3`/`.m4a`/`.aiff`): `l1` … `l8`. In `voice/voice.config.json` set `"provider": "human"`.
   Then re-run the build above.
2. **ElevenLabs (PAID)**: set `providers.elevenlabs.voiceId`, export `ELEVENLABS_API_KEY`, and run
   `node scripts/generate-voice.mjs --provider=elevenlabs --i-authorize-paid-api`. It refuses without both.
   (Implemented from the public API docs; not yet exercised.)
3. **System voice**: `local-say` (the default). It is **provisional**: the film shows a small
   "Provisional narration" mark until a real voice is used.

## Sound
Synthesised locally (sine waves and filtered noise), so it is original and unencumbered. Levels are relative to
the voice: SFX about −17…−27 dB, a bed at −33 dB that is ducked a further ~8 dB under speech. Final mix is
normalised to −16 LUFS / −1.5 dBTP. To use a licensed track instead, replace `.sfx/bed.wav` with your file
(it must be at least `duration + 1.5` s) and re-run `npm run mix`.

## Live narrated route
`/demo/presentation` shows a **Play 30-second demo** button. Clicking it starts `public/demo/soundtrack.mp3`
and the tour together, with captions. Sound is never started without a click. `?autoplay=1` runs silently;
`?film=1` is the clean capture mode used by `record-raw`.

## Licensing
Remotion is free for individuals and small teams and requires a company license above that: see
https://www.remotion.dev/license before using this commercially.
