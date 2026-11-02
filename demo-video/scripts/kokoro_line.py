"""Synthesise one narration line with Kokoro (local, MLX). Usage: kokoro_line.py <text> <out.wav>"""
import sys, glob, os, tempfile, shutil
from mlx_audio.tts.generate import generate_audio

text, out = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
generate_audio(text=text, model="mlx-community/Kokoro-82M-bf16", voice="af_heart", lang_code="a",
               speed=0.96, output_path=tmp, file_prefix="line", audio_format="wav", join_audio=True, verbose=False)
files = sorted(glob.glob(os.path.join(tmp, "line*.wav")))
shutil.move(files[0], out)
shutil.rmtree(tmp)
