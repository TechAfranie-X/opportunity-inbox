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
3. **Kokoro (current, final)**: `provider: "kokoro"` runs mlx-community/Kokoro-82M-bf16, voice af_heart, speed 0.96, locally via `../.venv-kokoro`. Free, offline.
4. **System voice**: `local-say` is provisional (it shows a small
   "Provisional narration" mark until a real voice is used.

## Sound
- **Music**: `audio/clean-product-confidence-1.mp3` (supplied by the project owner; not committed, drop it back into `audio/` to rebuild).
  `scripts/make-music.py` fits it to the film by beat-aligned cuts and crossfades only, never time-stretching: it enters at 0.46 s,
  repeats one intro beat so the track's drop lands on the inspector opening, removes 18 beats from the body, and lets the
  track's own ending ring under the closing frame. It is sidechain-ducked from the voice stem (about 16 dB below the voice at
  rest, 3.5-4.5 dB further under speech, recovering in pauses), lifted 5 dB after the last word, and the script prints the
  measurements. `scripts/check-mix.py` prints the voice-to-music margin per line, in full band and in the 300-4000 Hz speech band.
- **SFX**: only the inspector "open" remains, on the drop. The periodic ticks were removed because they fought the track's groove.
- Final mix is normalised to -14 LUFS, true peak about -2.4 dBTP; `.sfx/preview-voice-music.wav` is the voice+music preview without SFX.

## Live narrated route
`/demo/presentation` shows a **Play 30-second demo** button. Clicking it starts `public/demo/soundtrack.mp3`
and the tour together, with captions. Sound is never started without a click. `?autoplay=1` runs silently;
`?film=1` is the clean capture mode used by `record-raw`.

`public/demo/soundtrack.mp3` and `demo-video/audio/*.{mp3,wav}` are **generated and not in Git**: they derive from a locally
licensed music track and local TTS output. Rebuild them with `mix-audio.mjs`; without the file the Play button is silent.

## Licensing
Remotion is free for individuals and small teams and requires a company license above that: see
https://www.remotion.dev/license before using this commercially.
