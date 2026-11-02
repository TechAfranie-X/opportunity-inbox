"""
Edits the licensed track (audio/clean-product-confidence-1.mp3) to fit the film and ducks it under the narration.
Usage: make-music.py  (run from mix-audio.mjs; reads timeline.json + .sfx/stems/voice.wav, writes .sfx/stems/music.wav)

The track is 105 bpm (period 0.569 s) and loop-based. The edit only ever cuts on beats, with a short equal-power
crossfade, and never time-stretches:
  1. Music enters at film 0.46 s with a cosine fade-in (the voice starts at 0.45 s).
  2. One beat of the intro is repeated so the track's drop (track 9.91 s) lands on the inspector opening (film 10.82 s).
  3. 18 beats (10.24 s) of the body are removed so the track's own final hit lands just after the last spoken word.
  4. The track's natural ending rings out under the brand frame, and fades over the last 0.7 s.
Ducking is sidechain-style, driven by the voice stem. All numbers it prints are measured, not assumed.
"""
import json, subprocess, sys, re, os
import numpy as np, scipy.io.wavfile as w
from scipy import signal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SR = 48000
TL = json.load(open(f"{ROOT}/timeline.json"))
DUR = TL["duration"]

# ---- tunables (dB are relative to the narration's integrated loudness unless noted)
MUSIC_BELOW_VOICE = 16.0   # music body loudness vs voice before ducking (brief: 16-18)
DUCK_DB = 3.5              # sidechain reduction while speech is active
DENSE_EXTRA_DB = 1.0       # extra reduction while speech is nearly continuous (total 4-5 dB)
INTRO_LIFT_DB = 3.0        # the intro is ~6 dB quieter than the body in the source; lift it so it is still present, easing out at the drop
BRAND_LIFT_DB = 5.0        # rise after the final spoken word
ATTACK_S, RELEASE_S = 0.03, 0.45

# ---- beat grid of the source track and the edit points (all in track seconds)
P, PHASE = 0.569, 0.240
beat = lambda k: PHASE + P * k
FILM_DELAY = 0.46                      # music enters here, in film time (also puts the kick grid on the film's scene changes)
INTRO_REPEAT = (beat(3), beat(4))      # leave at beat 4, jump back one beat
CUT_FROM, CUT_TO = 12.76, 23.00        # 18 beats removed (12.76 -> 23.00)
XF = 0.07                              # crossfade length

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def read(path):
    sr, x = w.read(path)
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    return x

def lufs(path, ss=None, t=None):
    cmd = ["ffmpeg", "-hide_banner", "-nostats"]
    if ss is not None: cmd += ["-ss", str(ss), "-t", str(t)]
    r = sh(*cmd, "-i", path, "-af", "ebur128", "-f", "null", "-")
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)[-1])

# ---- decode the track
raw = "/tmp/_track48.wav"
sh("ffmpeg", "-y", "-v", "error", "-i", f"{ROOT}/audio/clean-product-confidence-1.mp3", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", raw)
trk = read(raw)  # (n, 2)

def cut(a, b): return trk[int(a * SR):int(b * SR)]

def join(parts):
    """Concatenate (array) parts with an equal-power crossfade of XF at every joint; each joint is centred just before the beat."""
    out = parts[0]
    n = int(XF * SR)
    t = np.linspace(0, np.pi / 2, n)[:, None]
    for p in parts[1:]:
        out = np.concatenate([out[:-n], out[-n:] * np.cos(t) + p[:n] * np.sin(t), p[n:]])
    return out

# Each part overlaps its neighbour by XF so the joint falls just before the beat it leads into.
h = XF
intro_a = cut(0, INTRO_REPEAT[1] + h)
intro_b = cut(INTRO_REPEAT[0] - h, CUT_FROM + h)
tail = cut(CUT_TO - h, len(trk) / SR)
music = join([intro_a, intro_b, tail])
# overlap bookkeeping: each join consumes XF, so film length of the first part is len(intro_a)-XF..., placed by construction
music = np.concatenate([np.zeros((int(FILM_DELAY * SR), 2), np.float32), music])

# the final hit and the drop, located in film time (verification, not assumption)
mono = music.mean(1)
def onset_near(t0, win=0.6):
    a, b = int((t0 - win) * SR), int((t0 + win) * SR)
    seg = np.abs(np.diff(signal.sosfilt(signal.butter(2, 120, "hp", fs=SR, output="sos"), mono[a:b]))) 
    env = np.convolve(seg, np.ones(480) / 480, "same")
    return (a + int(np.argmax(env > env.max() * 0.5))) / SR
print(f"drop lands ~{onset_near(10.82):.2f}s (inspector opens at {TL['film']['inspectorOpen']:.2f}s)")

# length to film, pad if short
n = int(DUR * SR)
music = music[:n] if len(music) >= n else np.concatenate([music, np.zeros((n - len(music), 2), np.float32)])

# ---- carve a little room for the voice: gentle dip where speech lives, and remove sub-bass rumble
def peaking(f0, gain_db, q):
    A = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / SR; al = np.sin(w0) / (2 * q); c = np.cos(w0)
    b = [1 + al * A, -2 * c, 1 - al * A]; a = [1 + al / A, -2 * c, 1 - al / A]
    return signal.tf2sos(np.array(b) / a[0], np.array(a) / a[0])
sos = np.vstack([signal.butter(2, 40, "hp", fs=SR, output="sos"), peaking(2600, -3.0, 0.7)])
music = signal.sosfilt(sos, music, axis=0).astype(np.float32)

# ---- voice activity -> sidechain envelope
voice = read(f"{ROOT}/.sfx/stems/voice.wav")[:n]
fr = int(0.01 * SR)
nf = len(voice) // fr
rms = np.sqrt((voice[: nf * fr].reshape(nf, fr) ** 2).mean(1) + 1e-12)
level_db = 20 * np.log10(rms)
active = (level_db > -48).astype(float)
# close micro-gaps inside words so the duck doesn't flutter
k = np.ones(15); active = (np.convolve(active, k, "same") > 0).astype(float)

def follow(x, attack, release, dt=0.01):
    out = np.zeros_like(x); y = 0.0
    ca, cr = np.exp(-dt / attack), np.exp(-dt / release)
    for i, v in enumerate(x):
        c = ca if v > y else cr
        y = c * y + (1 - c) * v
        out[i] = y
    return out
duck = follow(active, ATTACK_S, RELEASE_S)                                   # 0..1, fast down, gentle recovery
occ = np.convolve(active, np.ones(300) / 300, "same")                         # speech occupancy over 3 s
dense = np.clip((occ - 0.72) / 0.18, 0, 1)
dense = follow(dense, 0.4, 0.8)
red_db = -(DUCK_DB * duck + DENSE_EXTRA_DB * dense * duck)

# ---- fades and the brand-frame lift
t10 = np.arange(nf) * 0.01
fade_in = np.clip((t10 - FILM_DELAY) / 0.8, 0, 1); fade_in = np.sin(fade_in * np.pi / 2) ** 2
fade_out = np.clip((DUR - t10) / 0.7, 0, 1); fade_out = np.sin(fade_out * np.pi / 2) ** 2
voice_end = TL["lines"]["l8"]["end"]
lift = np.clip((t10 - (voice_end - 0.15)) / 0.6, 0, 1); lift = np.sin(lift * np.pi / 2) ** 2
drop_t = TL['film']['inspectorOpen']
intro = INTRO_LIFT_DB * (1 - np.clip((t10 - (drop_t - 1.2)) / 1.2, 0, 1))
env_db = red_db + BRAND_LIFT_DB * lift + intro

# ---- level: body of the film (after the drop, before the tagline), unducked, vs the voice's integrated loudness
tmp = "/tmp/_music_body.wav"
w.write(tmp, SR, (music * 32767).astype(np.int16))
body_a, body_b = 11.0, 25.0
voice_lufs = lufs(f"{ROOT}/.sfx/stems/voice.wav")
body_lufs = lufs(tmp, body_a, body_b - body_a)
gain_db = (voice_lufs - MUSIC_BELOW_VOICE) - body_lufs
print(f"voice {voice_lufs:.1f} LUFS | music body {body_lufs:.1f} LUFS -> gain {gain_db:+.1f} dB (target {MUSIC_BELOW_VOICE:.0f} dB below voice)")

tt = np.arange(n) / SR
base = lambda lift_db: 10 ** ((gain_db + np.interp(tt, t10, red_db + intro + lift_db * lift)) / 20) * np.interp(tt, t10, fade_in * fade_out)
rms_db = lambda x, a, b: 20 * np.log10(np.sqrt(np.mean(x[int(a * SR):int(b * SR)] ** 2)) + 1e-9)
# BRAND_LIFT_DB is measured, not assumed: the final frame (after the last word) must sit BRAND_LIFT_DB above the level the
# music holds under the narration in the body of the film (the source's own outro is quieter than its body, so a flat boost would fall short).
under_speech = music * base(0)[:, None]
ref = rms_db(under_speech.mean(1), TL["lines"]["l4"]["start"], TL["lines"]["l7"]["end"])
fa, fb = voice_end + 0.35, DUR - 0.35
need = (ref + BRAND_LIFT_DB) - rms_db(under_speech.mean(1), fa, fb)
print(f"music under speech {ref:.1f} dBFS; final frame needs {need:+.1f} dB of lift to sit {BRAND_LIFT_DB:.0f} dB above it")
g = base(need)
out = music * g[:, None]
os.makedirs(f"{ROOT}/.sfx/stems", exist_ok=True)
w.write(f"{ROOT}/.sfx/stems/music.wav", SR, (np.clip(out, -1, 1) * 32767).astype(np.int16))
print("music peak %.1f dBFS" % (20 * np.log10(np.abs(out).max())))
